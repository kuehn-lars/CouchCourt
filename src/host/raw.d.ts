/**
 * Vite's `?raw` suffix: the file's contents as a string. Used for the
 * Phosphor icon SVGs (decision 0017), which are inlined so they take
 * `currentColor`. Ambient, so it covers every file in `tsconfig.web.json` —
 * the controller's imports included — without adding `vite/client`'s types
 * to a project whose `types: []` is a purity guard.
 */
declare module "*?raw" {
	const content: string;
	export default content;
}
