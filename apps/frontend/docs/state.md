# State Management Rules

Zustand:

- Auth state
- UI state (sidebar, modals)
- Cart / booking draft

React Query:

- ALL API calls
- No API calls inside components directly

Rules:

- No duplicate server state in Zustand
- Cache keys must match backend routes
