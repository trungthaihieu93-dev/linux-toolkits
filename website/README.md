# website

Documentation site for this repository, built with [Astro](https://astro.build)
and [Starlight](https://starlight.astro.build). It is a standalone bun project,
not part of the Nx workspace in `ubuntu/`.

## Develop

Run from `website/` with [bun](https://bun.sh) (version pinned in `package.json`):

```sh
bun install --frozen-lockfile     # also run it in ../ubuntu (the generator needs it)
bun run gen        # regenerate the toolchain reference (runs before dev/check/build)
bun test           # generator tests
bun run dev        # dev server on http://localhost:4321
bun run check      # astro check (types and content schema)
bun run build      # static site in dist/, internal links validated
bun run preview    # serve the built site
```

## Layout

| Path                                 | Owns                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| `astro.config.mjs`                   | Site URL, Starlight options, sidebar, code block themes  |
| `src/content/docs/`                  | Pages (Markdown/MDX); the URL follows the file path      |
| `src/styles/theme.css`               | Colour and font tokens, with the measured contrast table |
| `src/styles/global.css`              | Tailwind v4 layer setup and the shared focus ring        |
| `src/components/ThemeProvider.astro` | Dark by default unless the visitor picked a theme        |
| `src/components/TerminalHero.astro`  | Home page hero with the copyable install command         |

Colours live only in `src/styles/theme.css`. If you change one, recompute the
contrast table there: text pairs need at least 4.5:1, non-text UI 3:1.

## Generated toolchain reference

`scripts/gen-toolchains.ts` runs the CLI from source
(`bun ../ubuntu/apps/linux-toolchain/src/main.ts list --json`) and writes
`src/content/docs/ubuntu/toolchains/<id>.md` and `src/data/toolchains.json`
through the pure renderer in `scripts/render-toolchains.ts`. Both outputs are
gitignored. To change a toolchain page, change the catalog in
`ubuntu/libs/toolchains`, not the generated file.
