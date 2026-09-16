# Authentication layout release — 16 September 2026

User-facing correction for the repeated live-site screenshot: a recovery link jammed against Continue, overly prominent link text, and email not carried to recovery.

## Implemented

Shared AuthShell for login, password recovery and invitations; compact Tasks brand and heading; 384px maximum content width; 48px text fields/buttons; 44px muted Forgot password? target on the Password label row, separate from Continue. Short screens scroll instead of clipping content. The login email follows links to/from recovery; passwords and reset proofs do not.

Follow-up review fixed two additional states: reset-error retry retains a 44px target, and accepted invitations carry their returned email into login without carrying the password. Missing invitation links show an explanation instead of a disabled unexplained form.

## Verification

- Full source/generator/lint/type/build and independent TypeScript checks passed; 166 unit tests passed.
- 112 Chromium/WebKit cases passed in one final run, including navigation, muted color, target sizes, 320px/short-height layouts and synthetic invitation/reset-error states.
- 18 Storybook interaction/accessibility checks passed.
- Five existing application visual comparisons passed without updating baselines.
- Eighteen production-built auth screenshots were captured across Chromium/WebKit and inspected. Responses in those captures were synthetic; no real account or email was used.

App review completed with all three roles (security/correctness/performance) and no remaining findings. A later test-only fix waits for the actual login link before reading computed styles; it changes no application behavior. No review hooks or accessibility rules were disabled.

Public deployment and exact merged SHA are recorded in the associated PR only after promotion and canonical-browser checks. This file does not itself assert publication.

## Open requirements

Owner email ultra@glide.vc already exists. Real reset delivery remains a separate configuration blocker; this release does not install Resend secrets, change passwords, send mail or claim authenticated access. The full remaining product contract is in [MASTER-ACCEPTANCE.md](MASTER-ACCEPTANCE.md): draft-journal release, original-reference parity, complete Linear import and attachment acceptance are not implied by this UI release.
