# daer-react-template

Personal starting point for new React + TypeScript + Vite projects. Carries over the tooling and conventions worth keeping every time, without any project-specific code.

## Commands

```bash
pnpm dev        # start dev server
pnpm build      # tsc -b && vite build
pnpm lint       # eslint .
pnpm preview    # preview production build
pnpm updates    # npm-check-updates --interactive --format group
```

Pre-commit hook (Husky): runs a full `tsc` type-check, then `lint-staged` (ESLint `--fix` + Prettier `--write`) on staged `.ts`/`.tsx` files only.

## Stack

React 19, TypeScript, Vite, Redux Toolkit, React Router v8, Emotion (CSS-in-JS), React Hook Form + Zod, Axios, Sonner (toasts), FontAwesome icons.

**Treat these as defaults, not requirements** — they're what I reach for absent other constraints. If a project says "use Tailwind" or "use MUI," swap the relevant piece rather than fighting the default:

- **Redux Toolkit** is the heaviest opinion here. Small projects may not need it at all — Context or nothing might be enough.
- **Emotion** (`css` prop, configured via `jsxImportSource` in `vite.config.ts`) is the CSS-in-JS default. Access the theme via `useAppTheme()` from `src/styles/hooks.ts`, not `useTheme()` directly (it's typed against `GlobalTheme` via `src/styles/emotion.d.ts`).

## Structure

```
src/
  api/          axios instance + response interceptor (401/403 -> "/", 404 -> catch-all route)
  components/   empty — feature components go here
    atoms/      empty — primitive UI components (Button, Typography, etc.) go here
  contexts/     GlobalLoadingIndicatorContext — backs useThunk's optional global loading state
  pages/        one directory per route; Homepage and NotFound are the only real ones
  store/        Redux Toolkit setup
    hooks/      useAppDispatch / useAppSelector (typed), useThunk (see below)
    slices/     empty — add slices here
    thunks/     empty — add thunks here
  styles/       theme.ts + colors.ts (real values, kept from a previous project as a working example — reskin freely), hooks.ts, emotion.d.ts
```

`components/` and `components/atoms/` are intentionally empty — copy in whatever primitives the new project actually needs rather than starting with a full library.

### `useThunk`

`src/store/hooks/useThunk.ts` wraps dispatching a Redux Toolkit thunk with:

- a success/error toast (via `sonner`)
- an optional redirect on success (`successRedirectRoute`)
- an optional global loading flag (`useGlobalLoader`), read from `GlobalLoadingIndicatorContext` in `src/contexts/`

It works out of the box with no thunks defined yet — `useContext` just falls back to the context's default (`isVisible: false`, no-op setter) if nothing provides it. There's intentionally no `MainWrapper`/spinner component wired up to _show_ that loading state, since `components/` starts empty — add a provider + spinner per-project once there's UI to hook it to (see `dual-cookbook-client`'s `MainWrapper` for a reference implementation: a `useState` + `useMemo`'d context value wrapping the app, toggled by `handleShowLoadingIndicator`).

## Environment

```
VITE_BASE_API_URL=   # falls back to http://localhost:3000 if unset (src/api/constants.ts)
```

## Using this as a new project

This repo is a **GitHub template repository**. Don't `git clone` it — that drags along this repo's history and `origin` remote. Instead:

- GitHub UI: open the repo, click **"Use this template" → "Create a new repository"**.
- CLI: `gh repo create my-new-project --template=<owner>/daer-react-template --clone`

Either way you get a single fresh initial commit with no relation back to this repo (or to whatever project's `main` you started this template from — none of that history is here). After creating it: update `package.json`'s `name`, `index.html`'s `<title>`, and start replacing `Homepage`.

If you ever want to pull a later improvement made here (e.g. a new ESLint rule) into a project already started from this template, there's no automatic path — re-copy the relevant config file by hand. Tracking this repo as an `upstream` remote and merging is possible but not worth the complexity for a personal template.

Created by [@Gennadii Guliakov] (https://github.com/DaerBR), 2026.
