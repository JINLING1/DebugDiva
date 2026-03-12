export function getConfig(config: string) {
	return import.meta.env[`VITE_${config}`];
}
