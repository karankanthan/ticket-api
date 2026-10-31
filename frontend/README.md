# TicketFlow web app

React + TypeScript + Vite + Tailwind CSS front end for the ticket API.

## Run locally (Windows PowerShell)

Start the backend first (from the project folder):

```powershell
.\scripts\start-backend.ps1
```

Then, in a second window:

```powershell
.\scripts\start-frontend.ps1
```

Open http://localhost:5173. `.\scripts\dev.ps1` opens both windows at once.

During development, Vite forwards `/api`, `/health`, `/summary` and `/approval-requests` to the backend, so the browser talks to a single origin. `/triage` is not forwarded: AI Triage is a standalone backend capability, not part of the TicketFlow app (`src/pages/TriagePage.tsx` is kept but not routed). Browser pages such as `/tickets` and `/act/<token>` are not forwarded. Change the backend address or port in `frontend/.env.local` (see `.env.example`). `VITE_API_BASE_URL` (for example the Task 4 deployment in `frontend/.env`) only applies to production builds; the dev server always uses the local backend.

## Commands

```powershell
npm test         # Vitest + Testing Library
npm run lint     # ESLint
npm run build    # type-check and production build into dist/
```

## Structure

- `src/api/`: the central HTTP client (`client.ts`), endpoint functions and response types
- `src/hooks/useApi.ts`: data loading with polling, refresh on focus and a global refresh after changes
- `src/components/ui/`: design-system components (buttons, cards, badges, dialogs, toasts, forms)
- `src/pages/`: one file per page; `ManagerActionPage` is the page opened from manager email links
- `src/test/`: tests, a fetch mock and fixtures shaped like real API responses

## Admin key

If the backend sets `ADMIN_API_KEY`, enter it on the Settings page. It is kept only for the current browser tab session and is never part of the built code.
