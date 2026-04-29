# E2E — Scenario A (rent a vehicle)

Run with the `agent-browser` skill. Pre-conditions:
- `pnpm dev` running on `http://localhost:3100`.
- DB seeded: `pnpm seed:domain` ran successfully.
- A customer named `ana.khan@example.com` exists in `customers`.

## Steps

1. Navigate to `http://localhost:3100/chat?customer=ana.khan@example.com`.
   - Assert: page title contains "Auto-ride"; the "Replying as: ana.khan@example.com" pill is visible.
2. Click the suggestion button containing "weekend trip".
   - Assert: the textarea now contains the full suggestion string.
3. Click the "Send" button.
   - Assert: URL changes to a path matching `/tasks/[uuid]` within 15s.
4. Wait for the canvas to render.
   - Assert: at least 2 agent nodes are visible (dispatcher + ≥ 1 worker).
5. Wait up to 90s for the first HITL approval card.
   - Assert: a card titled "Rental confirmation" is visible with a numeric "Total: $..." line.
   - Take a screenshot.
6. Click the "Approve" button on the rental-confirm card.
   - Assert: the card transitions to "approved" state.
7. Wait up to 90s for the second HITL card.
   - Assert: a card titled "Payment charge" is visible.
   - Take a screenshot.
8. Click the "Approve" button on the payment-charge card.
9. Wait up to 60s for the run to terminate.
   - Assert: page shows "done" or "completed" status.
10. Navigate to `/billing`.
    - Assert: the most recent paid invoice references the customer "Ana Khan".
11. Navigate to `/map`.
    - Assert: at least one in-use marker is visible; clicking it opens the side panel with a vehicle card.
    - Take a screenshot of the map.

## Failure capture

On any failed assertion, take a screenshot and dump:
- console logs from the page
- the current URL
- the most recent 50 task_events for the active taskId
