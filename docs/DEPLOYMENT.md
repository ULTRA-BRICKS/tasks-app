# Deployment

The active source is now [Forgejo](https://git.hyperide.ai/ultrabricks/tasks-app), not GitHub.

Read the current [operations runbook](OPERATIONS.md) for local setup, the existing Vercel project, Neon initialization, private Blob/S3 configuration and candidate promotion. The previous GitHub-token/Actions publication instructions are retired; do not create a second publisher.

Production readiness is checked with `/api/ready`, separately from `/api/health`. A successful build or an HTTP 200 health response does not establish that the database and owner account are ready. No request or frontend build applies migrations automatically.

For Vercel Blob use `STORAGE_DRIVER=blob` and server-only `BLOB_READ_WRITE_TOKEN` from a private store. S3/R2 uses `STORAGE_DRIVER=s3` and the S3 settings from `.env.example`. Local disk storage is development-only.

Current canonical production URL: **https://tasks-ultrabricks.vercel.app**. [Release verification](RELEASE-2026-09-12.md).
