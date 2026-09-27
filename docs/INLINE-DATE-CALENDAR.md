# Inline dates with an anchored calendar

User requirement: keep the existing start/due date field in place and open a compact calendar below it, rather than another form with an extra date input and Apply. Current task UB-41 / c28ed83b-2423-4d0d-b86c-381c13513c30; no account or domain migration is involved.

Design: one named text input accepts ISO date-only values and keeps invalid typing visible. Enter or blur commits valid typed dates; Escape restores the last server/draft value. A calendar icon or the input opens the same anchored nonmodal BaseUI Popover; the popup contains no input and no Apply action. Choosing a day commits it and returns focus. Navigating months never changes the property. Today and Clear are compact convenience actions. Dates are computed as calendar values in UTC rather than local-time milliseconds, preventing DST/offset date drift.

Retain the existing DateProperty(value,onChange,disabled) interface and parent version/permission/error handling. No extra component library or browser storage of credentials. Invalid local input survives errors while this editor is mounted; do not claim this solves the wider persistent workspace/draft-cache backlog.

Keyboard: one roving grid tab stop; arrows move by day/week,Home/End by week,PageUp/Down by month,Shift+PageUp/Down by year,Enter/Space choose and Escape dismiss. Use native table/grid semantics, full-date button labels and a live month heading. Input remains accessible and16px on touch. Popup must fit320/393/430px and safe collision boundaries without horizontal page scroll.

Evidence plan: existing two browser assertions already fail because there is no inline input. Add leap-year/month-end/date-range model tests and real-browser input,calendar,focus,month-browsing,Escape,readonly,timezone and mutation-failure cases. Check new/existing task and project/cycle callers; inspect a phone capture, not just attributes. Preserve original reference images outside Git and old APIs inside the domain layer.

Primary references: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/ for calendar keyboard conventions (the example itself is not shipped as production code); https://base-ui.com/react/components/popover for anchor,collision and focus primitives. Our panel is nonmodal so the original input stays usable.
