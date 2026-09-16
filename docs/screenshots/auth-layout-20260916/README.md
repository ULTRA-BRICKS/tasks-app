# Auth screenshots

These are captures of the production-built React application in Chromium and WebKit, DPR 1. Viewports include 320×568, 393×480, 393×852 and 1440×900.

The application sources used for these captures were verified against commit `3b8f02c`: the screenshot runner's original SHA-256 checksums matched the current auth components, stylesheet and DTCG tokens. The detailed local measurement JSON is retained on the operator's computer, not published as application code.

Scenes cover login, small/short screens, desktop, recovery, new password, invalid links, invitations and mail-unavailable feedback. Auth/network responses were synthetic. No real credentials, real reset request or outgoing email were used. There were no page errors or horizontal-overflow findings in the recorded scenes.

These screenshots verify this implementation and its states. They do not certify 90% similarity to the original 50-screen Linear PDF, which remains a separate acceptance item.
