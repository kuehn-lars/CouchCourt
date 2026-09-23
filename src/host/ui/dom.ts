/**
 * Three small things every host overlay needs. `update` runs once a frame,
 * so writes are skipped when nothing changed — setting the same text sixty
 * times a second still dirties the DOM.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className = "",
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	node.append(...children);
	return node;
}

export function setText(node: HTMLElement, text: string): boolean {
	if (node.textContent === text) return false;
	node.textContent = text;
	return true;
}

let reduced: MediaQueryList | null = null;

/** `Element.animate`, or nothing at all under reduced motion. */
export function play(
	node: Element,
	keyframes: Keyframe[],
	options: KeyframeAnimationOptions,
): void {
	// Looked up on first use, not at import: `render/ui.test.ts` imports
	// this file's neighbours in Node, where there is no window.
	reduced ??= window.matchMedia("(prefers-reduced-motion: reduce)");
	if (reduced.matches) return;
	node.animate(keyframes, { easing: "cubic-bezier(.2,.8,.2,1)", ...options });
}
