# RAG 离线评测

方案见 [docs/rag-design.md](../../docs/rag-design.md) 第 8 节。

```bash
pnpm eval:rag                  # 评测示例集 eval/rag/sample
pnpm eval:rag --suite main     # 评测真实语料 eval/rag/main
pnpm eval:rag:prepare          # 重新生成 eval/rag/main/docs（需要联网和 Chrome / Edge）
```

`main` 套件的语料来源、固定的 commit 和许可证见 [main/SOURCES.md](main/SOURCES.md)。`docs/` 由脚本生成，不要手工修改；题目在 `main/dataset.jsonl` 中维护。

报告写入 `eval/reports/<suite>.md`。E1 / E3 / E4 需要在 `.env.local` 配置硅基流动 API Key，向量和重排序分数按文本哈希缓存在 `eval/rag/.cache/`；没有 Key 时只运行 BM25（E2）。有 Key 时还会运行拒答阈值扫描、E5（LLM 查询改写，硅基流动免费对话模型，改写结果同样缓存）和 E6（切块大小）、E7（上下文前缀）消融；E8 另需百炼 API Key。

## 目录约定

```text
eval/rag/<suite>/
  docs/            评测文档（PDF / DOCX / Markdown / 文本 / 代码）
  dataset.jsonl    题目，每行一个 JSON
```

`sample` 是根据本项目 README 编写的小语料，只用来验证评测流水线能跑通，**它的分数没有参考意义**。`main` 是真实评测集；新增第三方文档前先确认其许可证允许再分发。

## 题目格式

```json
{
  "id": "q017",
  "type": "keyword",
  "question": "ERR_PNPM_PEER_DEP_ISSUES 怎么处理？",
  "answer": "参考答案（供生成质量评分）",
  "evidence": [
    { "doc": "pnpm-faq.pdf", "quote": "从文档中原样复制的一段话" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `type` | `factual` 事实定位 / `keyword` 关键词与报错码 / `multi_section` 多段综合 / `follow_up` 多轮追问 / `paraphrase` 口语化改写（不用文档术语） / `no_answer` 文档中无答案 |
| `history` | `follow_up` 必填，前置对话 `[{ "role": "user", "content": "…" }, …]` |
| `evidence` | 证据列表；`no_answer` 必须为空数组，其余类型不能为空 |
| `evidence[].quote` | 从文档**原样复制**的一句或一段。匹配时忽略空白差异，所以从 PDF 复制时的换行不影响定位 |
| `evidence[].occurrence` | 引文在文档中出现多次时，指定第几次出现（从 1 开始） |

**为什么用引文而不是 chunk id 或字符偏移：** 调整解析或切块参数后，chunk id 和偏移都会变化，引文不会。脚本运行时把引文定位成字符区间；chunk 与区间的重叠不少于两者中较短者的一半，即视为命中。

## 建议配比

| 题型 | 占比 |
| --- | --- |
| factual | 40% |
| keyword | 20% |
| multi_section | 20% |
| follow_up | 10% |
| no_answer | 10% |

至少有一部分证据应位于文档 40,000 字符之后，这样 E0 基线才能体现现状的截断问题。
