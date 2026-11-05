// #269, narrowed by #571 and #401: whether Skein itself should act on a
// Cmd/Ctrl-clicked terminal link, or defer because the foreground CLI
// already owns the click (see `HarnessCapabilities.opensClickedLinks` in
// data.tsx for the full story — Claude Code's fullscreen renderer opens
// the URL itself once mouse tracking is on, so both opening it would show
// two tabs).
//
// Deferring is only safe when the CLI really receives the click and acts:
// - #571: on macOS the modifier is Cmd, and xterm's mouse protocol has no
//   Cmd bit, so the CLI sees a plain click and opens nothing. Never defer.
// - #401: with `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` truthy in the harness
//   env the CLI ignores clicks (tracking stays on for scrolling). Never
//   defer.

/** Plain-text URIs WebLinksAddon turns into links (#24): any well-formed
 *  `scheme://…`, not only http(s), so the OS picks the handler. The leading
 *  word boundary and ASCII-only scheme keep `std::vector` out.
 *
 *  #706: the last character can't be sentence punctuation (`.,;:!?`), so
 *  "see https://x.dev/a." or "https://x.dev/a, and" open `https://x.dev/a`.
 *  The same set file paths drop (`TRAILING` in terminalPathText.ts); a URL
 *  that really ends in one of those loses it, as in other terminals.
 *
 *  No `g` flag: WebLinkProvider appends one itself, and `gg` throws. */
export const URI_REGEX =
	/\b[a-zA-Z][a-zA-Z0-9+.-]+:\/\/[^\s()[\]{}"'<>\\^`|]*[^\s()[\]{}"'<>\\^`|.,;:!?]/;

export interface LinkPolicyInput {
	isMac: boolean;
	/** `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` is truthy in the harness env. */
	mouseClicksDisabled: boolean;
	mouseTrackingOn: boolean;
	cliOpensClickedLinks: boolean;
}

/** True when Skein should open the link itself. False only when the CLI
 *  will provably open it: not macOS, clicks not disabled, the foreground
 *  app has mouse tracking on, and the CLI opens clicked links itself. */
export function shouldHostOpenLink({
	isMac,
	mouseClicksDisabled,
	mouseTrackingOn,
	cliOpensClickedLinks,
}: LinkPolicyInput): boolean {
	return isMac || mouseClicksDisabled || !mouseTrackingOn || !cliOpensClickedLinks;
}
