// terminalPathLinks (#704) — Cmd/Ctrl-click a file path in terminal output to
// open it in the OS default app (Preview for a PNG, Finder for a folder).
// The URL matcher in terminalSetup.ts only takes `scheme://…`, so a bare
// `/private/tmp/…/shot.png` an agent prints was dead text.
//
// Only paths that exist are links: the provider asks the backend to stat
// every reading of every candidate around the hovered row in one IPC
// (xterm caches the reply while the pointer stays on that row), and a
// link takes its longest reading that exists — which is how a path a CLI
// broke across rows comes back whole (terminalPathText.ts). Relative
// paths resolve against the harness's spawn cwd, so a shell that has
// `cd`'d elsewhere resolves them from the wrong place — absolute paths
// are the case that matters.
//
// Unlike URL clicks on Windows/Linux, this never stands aside for the CLI
// (#269): that deferral exists because Claude Code opens the URLs it
// renders as links, and nothing shows it doing the same for a plain path.

import { invoke } from "@tauri-apps/api/core";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { pathLinks, rowsAround } from "./terminalPathText.ts";

export function pathLinkProvider(
	term: Terminal,
	cwd: string,
	isModifierClick: (event: MouseEvent) => boolean,
): ILinkProvider {
	const open = (event: MouseEvent, path: string) => {
		if (!isModifierClick(event)) return;
		event.preventDefault();
		console.info("[skein] open path:", path);
		invoke("open_terminal_path", { path }).catch((err: unknown) => {
			console.warn("[skein] open path failed:", path, String(err));
		});
	};
	return {
		provideLinks(y, callback) {
			const { rows, focus } = rowsAround(term.buffer.active, y);
			const found = pathLinks(rows, focus);
			const variants = found.flat();
			if (variants.length === 0) {
				callback(undefined);
				return;
			}
			invoke<(string | null)[]>("resolve_terminal_paths", {
				cwd,
				candidates: variants.map((v) => v.path),
			})
				.then((resolved) => {
					const links: ILink[] = [];
					let i = 0;
					for (const link of found) {
						const hit = link.map((v, k) => ({ v, path: resolved[i + k] })).find(({ path }) => path);
						i += link.length;
						if (!hit?.path) continue;
						const path = hit.path;
						links.push({
							range: { start: hit.v.start, end: hit.v.end },
							text: hit.v.text,
							activate: (event) => open(event, path),
						});
					}
					callback(links.length > 0 ? links : undefined);
				})
				.catch((err: unknown) => {
					console.warn("[skein] resolve_terminal_paths failed:", String(err));
					callback(undefined);
				});
		},
	};
}
