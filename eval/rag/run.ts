/**
 * RAG 离线评测入口：E0 全文注入基线、切块诊断、E1–E4 检索实验、拒答阈值扫描、E6–E8 消融。
 *
 *   pnpm eval:rag                      # 默认评测 eval/rag/sample
 *   pnpm eval:rag --suite main         # 评测 eval/rag/main（真实语料，需自行准备）
 *   pnpm eval:rag --suite main --out eval/reports/custom.md
 *
 * 目录约定：eval/rag/<suite>/docs/ 放文档，eval/rag/<suite>/dataset.jsonl 放题目。
 * E1 / E3 / E4 需要在 .env.local 配置硅基流动 API Key（向量与重排序分数都按文本哈希缓存）；
 * 没有 Key 时只运行 E2（BM25）。E8 需要百炼 API Key，没有时跳过。
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	parseDocumentFile,
	type ParsedDocumentData,
} from '../../functions/_shared/fileParsing';
import { chunkDocument, type ChunkOptions } from '../../functions/_shared/chunker';
import {
	resolveEmbeddingProvider,
	resolveRerankProvider,
	resolveRewriteProvider,
	type RerankEnv,
} from '../../functions/_shared/ragUpstream';
import { RERANK_CANDIDATES, RERANK_SCORE_THRESHOLD } from '../../src/services/rag/documentIndex';
import { MAX_DOCUMENT_CONTEXT_TEXT_LENGTH } from '../../src/types/attachment';
import { createCachedEmbedder, type CachedEmbedder } from './embeddingCache';
import { createCachedReranker, type CachedReranker } from './rerankCache';
import { createCachedRewriter } from './rewriteCache';
import {
	evaluateRetrieval,
	type ModeResult,
	type RetrievalEvalOptions,
	type RetrievalEvalResult,
} from './retrievalEval';
import {
	mean,
	parseDataset,
	percentile,
	resolveEvidence,
	spanHit,
	type EvalItem,
	type Span,
} from './metrics';

/** 评测时解析全文，便于定位 40,000 字符之后的证据。 */
const EVAL_MAX_TEXT_LENGTH = 2_000_000;
/** 现状下所有激活附件合计的注入上限（见 src/types/attachment.ts）。 */
const CURRENT_ACTIVE_TEXT_LIMIT = 80_000;

const CHUNK_CONFIGS: (Required<Pick<ChunkOptions, 'targetSize' | 'overlap'>> & {
	label: string;
})[] = [
	{ label: '300 / 50', targetSize: 300, overlap: 50 },
	{ label: '600 / 100（默认）', targetSize: 600, overlap: 100 },
	{ label: '1000 / 150', targetSize: 1000, overlap: 150 },
];

const MIME_BY_EXTENSION: Record<string, string> = {
	'.pdf': 'application/pdf',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const { values: args } = parseArgs({
	options: {
		suite: { type: 'string', default: 'sample' },
		out: { type: 'string' },
	},
});

const suiteDir = join(root, 'eval/rag', args.suite!);
const outPath = resolve(root, args.out ?? `eval/reports/${args.suite}.md`);

const codePointPrefixLength = (text: string, maxCodePoints: number) => {
	let count = 0;
	let index = 0;
	while (index < text.length && count < maxCodePoints) {
		const code = text.charCodeAt(index);
		index += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
		count += 1;
	}
	return index;
};

const groupBy = <T, K extends string>(values: readonly T[], key: (value: T) => K) => {
	const groups = {} as Record<K, T[]>;
	for (const value of values) (groups[key(value)] ??= []).push(value);
	return groups;
};

const percent = (value: number | undefined) =>
	value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
const integer = (value: number | undefined) =>
	value === undefined ? '—' : Math.round(value).toLocaleString('en-US');

const table = (header: string[], rows: (string | number)[][]) =>
	[
		`| ${header.join(' | ')} |`,
		`| ${header.map(() => '---').join(' | ')} |`,
		...rows.map(row => `| ${row.join(' | ')} |`),
	].join('\n');

const loadDocuments = async () => {
	const docsDir = join(suiteDir, 'docs');
	const names = (await readdir(docsDir)).filter(name => !name.startsWith('.'));
	const documents = new Map<string, ParsedDocumentData>();
	for (const name of names.sort()) {
		const bytes = await readFile(join(docsDir, name));
		const file = new File([bytes], name, {
			type: MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? '',
		});
		documents.set(
			name,
			await parseDocumentFile(file, { maxTextLength: EVAL_MAX_TEXT_LENGTH }),
		);
	}
	return documents;
};

const resolveItems = (
	items: EvalItem[],
	documents: Map<string, ParsedDocumentData>,
) =>
	items.map(item => ({
		item,
		spans: item.evidence.map(label => {
			const document = documents.get(label.doc);
			if (!document) throw new Error(`题目 ${item.id} 引用了不存在的文档：${label.doc}`);
			return resolveEvidence(label, document.text);
		}),
	}));

type ResolvedItem = ReturnType<typeof resolveItems>[number];

/**
 * E0：现状的全文注入。每个文档截断到 40,000 字符，题目涉及的全部文档一起注入。
 * 指标是“证据是否落在模型可见范围内”——不可见的证据，模型不可能据此作答。
 */
const evaluateFullText = (
	resolved: ResolvedItem[],
	documents: Map<string, ParsedDocumentData>,
) => {
	const visibleEnd = new Map(
		[...documents].map(([name, document]) => [
			name,
			codePointPrefixLength(document.text, MAX_DOCUMENT_CONTEXT_TEXT_LENGTH),
		]),
	);

	const rows = resolved
		.filter(({ spans }) => spans.length)
		.map(({ item, spans }) => {
			const docs = [...new Set(spans.map(span => span.doc))];
			const visible = spans.filter(span => span.charEnd <= visibleEnd.get(span.doc)!);
			const injected = docs.reduce((sum, doc) => sum + visibleEnd.get(doc)!, 0);
			return {
				type: item.type,
				spanCoverage: visible.length / spans.length,
				fullyAnswerable: visible.length === spans.length ? 1 : 0,
				injectedChars: injected,
				overActiveLimit: injected > CURRENT_ACTIVE_TEXT_LIMIT ? 1 : 0,
			};
		});

	return {
		questions: rows.length,
		spanCoverage: mean(rows.map(row => row.spanCoverage)),
		fullyAnswerable: mean(rows.map(row => row.fullyAnswerable)),
		injectedChars: mean(rows.map(row => row.injectedChars)),
		overActiveLimit: mean(rows.map(row => row.overActiveLimit)),
		byType: Object.entries(groupBy(rows, row => row.type)).map(([type, group]) => ({
			type,
			count: group.length,
			fullyAnswerable: mean(group.map(row => row.fullyAnswerable)),
		})),
	};
};

/**
 * 切块诊断：不做检索，只检查切块本身。
 * “可命中率”= 至少有一个 chunk 命中的证据比例；低于 100% 说明证据被切得太碎。
 */
const diagnoseChunking = (
	resolved: ResolvedItem[],
	documents: Map<string, ParsedDocumentData>,
) =>
	CHUNK_CONFIGS.map(config => {
		const chunksByDoc = new Map(
			[...documents].map(([name, document]) => [
				name,
				chunkDocument(document.text, document.segments, config).map(
					(chunk): Span & { length: number } => ({
						doc: name,
						charStart: chunk.charStart,
						charEnd: chunk.charEnd,
						length: chunk.charEnd - chunk.charStart,
					}),
				),
			]),
		);
		const allChunks = [...chunksByDoc.values()].flat();
		const spans = resolved.flatMap(({ spans }) => spans);
		const hittable = spans.filter(span =>
			(chunksByDoc.get(span.doc) ?? []).some(chunk => spanHit(chunk, span)),
		);
		const chunksPerEvidence = spans.map(
			span =>
				(chunksByDoc.get(span.doc) ?? []).filter(
					chunk => chunk.charStart < span.charEnd && span.charStart < chunk.charEnd,
				).length,
		);
		return {
			label: config.label,
			chunks: allChunks.length,
			meanLength: mean(allChunks.map(chunk => chunk.length)),
			p95Length: percentile(allChunks.map(chunk => chunk.length), 95),
			hittable: spans.length ? hittable.length / spans.length : undefined,
			meanChunksPerEvidence: mean(chunksPerEvidence),
		};
	});

/** E5 对比的免费改写模型（硅基流动）。 */
const REWRITE_MODELS = ['THUDM/GLM-4-9B-0414', 'Qwen/Qwen2.5-7B-Instruct'];

const cacheDir = join(root, 'eval/rag/.cache');
const cacheName = (kind: string, model: string) =>
	join(cacheDir, `${kind}-${model.replace(/\W+/g, '_')}.json`);

/** 按 Provider 创建带缓存的向量化与重排序；对应 Key 未配置时返回 undefined。 */
const createModels = async (env: RerankEnv) => {
	let embedder: CachedEmbedder | undefined;
	let reranker: CachedReranker | undefined;
	try {
		const config = resolveEmbeddingProvider(env);
		embedder = await createCachedEmbedder(config, cacheName('embeddings', config.model));
	} catch {
		embedder = undefined;
	}
	try {
		const config = resolveRerankProvider(env);
		reranker = await createCachedReranker(config, cacheName('rerank', config.model));
	} catch {
		reranker = undefined;
	}
	const options: RetrievalEvalOptions = {
		embed: embedder ? texts => embedder.embed(texts) : undefined,
		rerank: reranker ? (query, documents) => reranker.rerank(query, documents) : undefined,
	};
	return { embedder, reranker, options };
};

const score = (value: number | undefined) => value?.toFixed(3) ?? '—';

const MODE_HEADER = ['配置', 'Recall@5', 'Recall@10', 'MRR', 'nDCG@10', '注入完全召回', '平均注入字符'];

const modeRow = (row: ModeResult) => [
	row.label,
	percent(row.recall5),
	percent(row.recall10),
	score(row.mrr),
	score(row.ndcg10),
	percent(row.injectedFull),
	integer(row.injectedChars),
];

const retrievalSection = (
	result: RetrievalEvalResult,
	baselineFullyAnswerable: number | undefined,
	baselineInjectedChars: number | undefined,
) => {
	const rerank = result.modes.find(row => row.mode === 'rerank');
	return [
		'## E1–E4 检索实验',
		'',
		`检索池为全部文档的 ${result.chunkCount} 个 chunk（600 / 100）。查询使用规则式改写。Recall / MRR / nDCG 只统计有答案的题，按前 10 个结果计算。`,
		'',
		`“注入完全召回”= 应用实际注入给模型的片段（最多 8 条、6,000 字符、相邻块合并；E4 另加阈值 ${RERANK_SCORE_THRESHOLD}）覆盖了该题全部证据，可与 E0 的“完全可答率”直接对照。E4 对混合检索的前 ${RERANK_CANDIDATES} 个候选重排序。`,
		'',
		...result.skipped.map(note => `> ${note}`),
		...(result.skipped.length ? [''] : []),
		table(MODE_HEADER, [
			[
				'E0 全文注入（对照）',
				'—',
				'—',
				'—',
				'—',
				percent(baselineFullyAnswerable),
				integer(baselineInjectedChars),
			],
			...result.modes.map(modeRow),
		]),
		'',
		'按题型的 Recall@5 / 注入完全召回：',
		'',
		table(
			['题型', ...result.modes.map(row => row.label)],
			(result.modes[0]?.byType ?? []).map(({ type, count }) => [
				`${type}（${count}）`,
				...result.modes.map(row => {
					const item = row.byType.find(entry => entry.type === type);
					return `${percent(item?.recall5)} / ${percent(item?.injectedFull)}`;
				}),
			]),
		),
		'',
		...(rerank
			? [
					`E4 拒答：无答案题被判定为“没有答案”的比例 **${percent(rerank.refusal)}**，有答案题被误判的比例 **${percent(rerank.falseRefusal)}**（阈值 ${RERANK_SCORE_THRESHOLD}）。`,
					'',
				]
			: []),
		...(result.thresholdSweep
			? [
					'## 拒答阈值扫描（E4）',
					'',
					'重排序后最高分低于阈值即判定“资料中没有答案”，不注入任何片段。阈值越高拒答越积极，但有答案的题也更容易被误拒。',
					'',
					table(
						['阈值', '无答案题拒答率', '有答案题误拒率', '注入完全召回'],
						result.thresholdSweep.map(row => [
							row.threshold,
							percent(row.refusal),
							percent(row.falseRefusal),
							percent(row.injectedFull),
						]),
					),
					'',
				]
			: []),
		...(result.scoreSamples
			? [
					'<details><summary>每题重排序最高分与证据名次（按最高分升序）</summary>',
					'',
					table(
						['题目', '题型', '最高分', '证据名次'],
						[...result.scoreSamples]
							.sort((a, b) => a.topScore - b.topScore)
							.map(sample => [
								sample.id,
								sample.type,
								sample.topScore.toFixed(4),
								sample.evidenceRank ?? (sample.type === 'no_answer' ? '—' : '未召回'),
							]),
					),
					'',
					'</details>',
					'',
				]
			: []),
	];
};

const ablationSection = (
	title: string,
	description: string,
	rows: { label: string; result: RetrievalEvalResult }[],
) => [
	`## ${title}`,
	'',
	description,
	'',
	table(
		['变体', 'chunk 数', ...MODE_HEADER],
		rows.flatMap(({ label, result }) =>
			result.modes.map(row => [label, result.chunkCount, ...modeRow(row)]),
		),
	),
	'',
];

const main = async () => {
	const documents = await loadDocuments();
	const items = parseDataset(await readFile(join(suiteDir, 'dataset.jsonl'), 'utf8'));
	const resolved = resolveItems(items, documents);
	const fullText = evaluateFullText(resolved, documents);
	const chunking = diagnoseChunking(resolved, documents);
	const envFile = join(root, '.env.local');
	if (existsSync(envFile)) process.loadEnvFile(envFile);
	const primary = await createModels(process.env);
	const retrieval = await evaluateRetrieval(documents, resolved, primary.options);

	const ablations: string[] = [];
	const rewriteLatencies: { model: string; latencies: number[]; failures: number }[] = [];
	if (primary.reranker) {
		const modes: RetrievalEvalOptions['modes'] = ['hybrid', 'rerank'];
		const chunkRows: { label: string; result: RetrievalEvalResult }[] = [];
		for (const { label, chunk } of [
			{ label: '300 / 50', chunk: { targetSize: 300, overlap: 50 } },
			{ label: '600 / 100（默认）', chunk: undefined },
			{ label: '1000 / 150', chunk: { targetSize: 1000, overlap: 150 } },
		]) {
			chunkRows.push({
				label,
				result: await evaluateRetrieval(documents, resolved, { ...primary.options, chunk, modes }),
			});
		}
		ablations.push(
			...ablationSection(
				'E6 切块大小',
				'同样的检索流程（混合 → 重排序），只改变切块目标长度 / 重叠。',
				chunkRows,
			),
		);
		ablations.push(
			...ablationSection(
				'E7 上下文前缀',
				'去掉 embedding / BM25 / 重排序文本中的“《文档名》> 标题路径”前缀，验证前缀的价值。',
				[
					{ label: '有前缀（默认）', result: chunkRows[1].result },
					{
						label: '无前缀',
						result: await evaluateRetrieval(documents, resolved, {
							...primary.options,
							prefix: false,
							modes,
						}),
					},
				],
			),
		);

		// E5：LLM 查询改写（硅基流动免费模型），原查询 + 改写查询做多查询检索
		const e5Rows: { label: string; latencies: readonly number[]; failures: number; result: RetrievalEvalResult }[] = [];
		for (const model of REWRITE_MODELS) {
			const rewriter = await createCachedRewriter(
				resolveRewriteProvider({ ...process.env, RAG_REWRITE_MODEL: model }),
				cacheName('rewrite', model),
			);
			for (const rerankQuery of ['original', 'both', 'rewritten'] as const) {
				e5Rows.push({
					label: `${model.split('/').pop()} · 重排序用${{ original: '原问题', both: '原问题 + 改写', rewritten: '改写' }[rerankQuery]}`,
					latencies: rewriter.latenciesMs,
					failures: rewriter.failures,
					result: await evaluateRetrieval(documents, resolved, {
						...primary.options,
						rewrite: query => rewriter.rewrite(query),
						rerankQuery,
						modes: ['rerank'],
					}),
				});
			}
			await rewriter.save();
			rewriteLatencies.push({ model, latencies: [...rewriter.latenciesMs], failures: rewriter.failures });
		}
		const e5Line = (label: string, result: RetrievalEvalResult) => {
			const row = result.modes.find(mode => mode.mode === 'rerank')!;
			const paraphrase = row.byType.find(item => item.type === 'paraphrase');
			return [
				label,
				percent(row.recall5),
				score(row.mrr),
				percent(row.injectedFull),
				percent(paraphrase?.injectedFull),
				percent(row.refusal),
				percent(row.falseRefusal),
				integer(row.injectedChars),
			];
		};
		ablations.push(
			'## E5 LLM 查询改写',
			'',
			`用硅基流动的免费小模型把问题改写成带术语的检索查询，原查询与改写查询一起做多查询混合检索（RRF），再对前 ${RERANK_CANDIDATES} 个候选重排序。改写失败时只用原查询。“重排序用”指重排序打分时使用的查询；拒答阈值固定为 ${RERANK_SCORE_THRESHOLD}。`,
			'',
			table(
				['配置', 'Recall@5', 'MRR', '注入完全召回', '其中 paraphrase', '无答案拒答率', '有答案误拒率', '平均注入字符'],
				[
					e5Line('E4 不改写（对照）', chunkRows[1].result),
					...e5Rows.map(({ label, result }) => e5Line(`E5 ${label}`, result)),
				],
			),
			'',
			...rewriteLatencies.map(({ model, latencies, failures }) =>
				latencies.length >= 5
					? `- ${model} 改写延迟（本次未命中缓存的 ${latencies.length} 次）：P50 ${integer(percentile([...latencies], 50))} ms，P95 ${integer(percentile([...latencies], 95))} ms，失败 ${failures} 次。`
					: `- ${model}：改写结果来自缓存${failures ? `，失败 ${failures} 次` : ''}。`,
			),
			'',
		);

		const dashscopeKey = process.env.DASHSCOPE_API_KEY ?? '';
		const dashscope = /^sk-[A-Za-z0-9]{16,}$/.test(dashscopeKey)
			? await createModels({
					...process.env,
					RAG_EMBEDDING_PROVIDER: 'dashscope',
					RAG_RERANK_PROVIDER: 'dashscope',
				})
			: undefined;
		if (dashscope?.embedder && dashscope.reranker) {
			try {
				const result = await evaluateRetrieval(documents, resolved, {
					...dashscope.options,
					modes,
				});
				ablations.push(
					...ablationSection(
						'E8 商业模型对比',
						'百炼 text-embedding-v4 + qwen3-rerank 与默认的硅基流动 bge-m3 + bge-reranker-v2-m3 对比。',
						[
							{ label: '硅基流动（默认）', result: chunkRows[1].result },
							{ label: '百炼', result },
						],
					),
				);
				await dashscope.embedder.save();
				await dashscope.reranker.save();
			} catch (error) {
				ablations.push(
					'## E8 商业模型对比',
					'',
					`> 调用百炼失败，已跳过：${error instanceof Error ? error.message : String(error)}`,
					'',
				);
			}
		} else {
			ablations.push('## E8 商业模型对比', '', '> 未配置百炼 API Key，已跳过。', '');
		}
	}

	const latencies = primary.reranker?.latenciesMs ?? [];
	if (primary.embedder) {
		console.log(`本次调用向量化 API ${primary.embedder.requested} 条（其余来自缓存）`);
	}
	if (primary.reranker) console.log(`本次调用重排序 API ${latencies.length} 次（其余来自缓存）`);

	const typeCounts = Object.entries(groupBy(items, item => item.type)).map(([type, group]) => `${type} ${group.length}`);

	const report = [
		`# RAG 评测报告：${args.suite}`,
		'',
		`- 生成时间：${new Date().toISOString()}`,
		`- 题目：${items.length} 道（${typeCounts.join('，')}）`,
		`- 证据区间：${resolved.reduce((sum, { spans }) => sum + spans.length, 0)} 个`,
		'',
		'## 语料',
		'',
		table(
			['文档', '字符数', '页数', 'segment 数', '超过 40k'],
			[...documents].map(([name, document]) => [
				name,
				integer(Array.from(document.text).length),
				document.pageCount ?? '—',
				document.segments.length,
				Array.from(document.text).length > MAX_DOCUMENT_CONTEXT_TEXT_LENGTH ? '是' : '否',
			]),
		),
		'',
		'## E0 基线：全文注入（现状）',
		'',
		'每个文档截断到 40,000 字符后整体注入。指标衡量证据是否落在模型可见范围内，是生成质量的上限。',
		'',
		table(
			['指标', '数值'],
			[
				['有证据的题目数', fullText.questions],
				['证据可见率（按证据平均）', percent(fullText.spanCoverage)],
				['完全可答率（所有证据都可见）', percent(fullText.fullyAnswerable)],
				['平均每题注入字符数', integer(fullText.injectedChars)],
				['超过 80,000 字符合计上限的题目比例', percent(fullText.overActiveLimit)],
			],
		),
		'',
		table(
			['题型', '题数', '完全可答率'],
			fullText.byType.map(row => [row.type, row.count, percent(row.fullyAnswerable)]),
		),
		'',
		'## 切块诊断',
		'',
		'不做检索，只检查切块质量。“可命中率”低于 100% 说明有证据被切碎，任何检索策略都无法完整召回。',
		'',
		table(
			['目标长度 / 重叠', 'chunk 数', '平均长度', 'P95 长度', '证据可命中率', '每条证据跨 chunk 数'],
			chunking.map(row => [
				row.label,
				row.chunks,
				integer(row.meanLength),
				integer(row.p95Length),
				percent(row.hittable),
				row.meanChunksPerEvidence?.toFixed(2) ?? '—',
			]),
		),
		'',
		...retrievalSection(retrieval, fullText.fullyAnswerable, fullText.injectedChars),
		...(latencies.length >= 5
			? [
					`重排序延迟（本次未命中缓存的 ${latencies.length} 次调用，每次最多 ${RERANK_CANDIDATES} 个候选）：P50 ${integer(percentile([...latencies], 50))} ms，P95 ${integer(percentile([...latencies], 95))} ms。`,
					'',
				]
			: []),
		...ablations,
	].join('\n');

	await primary.embedder?.save();
	await primary.reranker?.save();
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, report, 'utf8');
	console.log(report);
	console.log(`报告已写入 ${relative(root, outPath)}`);
};

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});

