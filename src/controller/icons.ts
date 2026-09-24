/**
 * The controller's icons: Phosphor, regular weight, inlined so they take the
 * text colour (decision 0017). Its own copy of the host's `ui/icons.ts`
 * rather than an import from it — the phone bundle is the one that loads
 * over party Wi-Fi, and `src/host` is not a folder the controller imports.
 */

import arrowLeft from "@phosphor-icons/core/assets/regular/arrow-left.svg?raw";
import arrowRight from "@phosphor-icons/core/assets/regular/arrow-right.svg?raw";
import arrowUp from "@phosphor-icons/core/assets/regular/arrow-up.svg?raw";
import arrowsLeftRight from "@phosphor-icons/core/assets/regular/arrows-left-right.svg?raw";
import check from "@phosphor-icons/core/assets/regular/check.svg?raw";
import deviceMobile from "@phosphor-icons/core/assets/regular/device-mobile.svg?raw";
import gear from "@phosphor-icons/core/assets/regular/gear-six.svg?raw";
import handGrabbing from "@phosphor-icons/core/assets/regular/hand-grabbing.svg?raw";
import tennisBall from "@phosphor-icons/core/assets/regular/tennis-ball.svg?raw";
import trophy from "@phosphor-icons/core/assets/regular/trophy.svg?raw";
import wifiSlash from "@phosphor-icons/core/assets/regular/wifi-slash.svg?raw";
// Not Phosphor: the CouchCourt mark, two-colour, so it ignores `currentColor`.
import logo from "../logo.svg?raw";

export const ICON = {
	arrowLeft,
	arrowRight,
	arrowUp,
	arrowsLeftRight,
	check,
	deviceMobile,
	gear,
	handGrabbing,
	logo,
	tennisBall,
	trophy,
	wifiSlash,
} as const;

export type IconName = keyof typeof ICON;

/** Fills every `[data-icon]` placeholder in the page with its glyph, so the
 * HTML can say where an icon goes without carrying the SVG. */
export function fillIcons(root: ParentNode = document): void {
	for (const node of root.querySelectorAll<HTMLElement>("[data-icon]")) {
		const name = node.dataset.icon as IconName;
		if (name in ICON) node.innerHTML = ICON[name];
	}
}
