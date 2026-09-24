/**
 * The host's icons: Phosphor, regular weight, as inline SVG strings so they
 * take the text colour (decision 0017). One import per glyph keeps the other
 * thousand out of the bundle.
 */

import arrowsIn from "@phosphor-icons/core/assets/regular/arrows-in.svg?raw";
import arrowsLeftRight from "@phosphor-icons/core/assets/regular/arrows-left-right.svg?raw";
import arrowsOut from "@phosphor-icons/core/assets/regular/arrows-out.svg?raw";
import check from "@phosphor-icons/core/assets/regular/check.svg?raw";
import deviceMobile from "@phosphor-icons/core/assets/regular/device-mobile.svg?raw";
import gear from "@phosphor-icons/core/assets/regular/gear-six.svg?raw";
import handGrabbing from "@phosphor-icons/core/assets/regular/hand-grabbing.svg?raw";
import qrCode from "@phosphor-icons/core/assets/regular/qr-code.svg?raw";
import robot from "@phosphor-icons/core/assets/regular/robot.svg?raw";
import tennisBall from "@phosphor-icons/core/assets/regular/tennis-ball.svg?raw";
import trophy from "@phosphor-icons/core/assets/regular/trophy.svg?raw";
import wifiSlash from "@phosphor-icons/core/assets/regular/wifi-slash.svg?raw";
import x from "@phosphor-icons/core/assets/regular/x.svg?raw";
// Not Phosphor: the CouchCourt mark, two-colour, so it ignores `currentColor`.
import logo from "../../logo.svg?raw";

export const ICON = {
	arrowsIn,
	arrowsOut,
	arrowsLeftRight,
	check,
	deviceMobile,
	gear,
	handGrabbing,
	logo,
	qrCode,
	robot,
	tennisBall,
	trophy,
	wifiSlash,
	x,
} as const;

export type IconName = keyof typeof ICON;

/** An icon as an element, `aria-hidden` because every icon here sits next
 * to text that already says what it means. */
export function icon(name: IconName, className = "icon"): HTMLSpanElement {
	const span = document.createElement("span");
	span.className = className;
	span.setAttribute("aria-hidden", "true");
	span.innerHTML = ICON[name];
	return span;
}
