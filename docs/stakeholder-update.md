# Update for Mara: billing approvals prototype

## Progress

The prototype now works with your new helpdesk export. I loaded all 120 tickets from your file and tested the main flow: create an approval request for a ticket, see whether it needs escalating, and approve it. For example, a billing ticket with a $480 refund was correctly flagged for escalation.

## What changed

- The export now arrives by email each morning. For the demo, I'll load that morning's file by hand.
- Two columns were renamed. This didn't affect the prototype.
- The file no longer includes the date each ticket was resolved. The prototype still works, but the average resolution time report isn't available with this file.
- The demo moved to 11:30 tomorrow. The plan is unchanged.

## Risks

- Approval requests are only kept while the prototype is running. That's fine for the demo, but not for daily use yet.
- Refund amounts are typed in by hand for now, even though your file includes them.
- If tomorrow's file is laid out differently again, I'll use sample data so the demo still runs.

## What I need from you

1. Should a refund of exactly $200 be escalated, or only amounts above $200?
2. Was removing the resolved date intended, or can IT add it back?
3. Who will attend the demo, and how long do we have?