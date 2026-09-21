# Tasks plugin

Portable Agent Plugins package for the authenticated Tasks MCP server. No credentials belong in this package.

Install this folder in a compatible plugin host and connect using OAuth. For ChatGPT, register https://tasks-ultrabricks.vercel.app/api/mcp through the MCP connection management interface available to your account, choose dynamic client registration, and approve Tasks access in the browser. Account/workspace availability must be checked; this repository does not automatically enable developer mode.

If the host requires a registered OpenAI app mapping, register the live endpoint first, then use the actual returned app ID. No placeholder app ID is bundled. The portable mcp.json is directly usable by compatible MCP plugin hosts.

See ../../docs/CHATGPT-CONNECTOR.md for callback configuration, deployment and security details. Source: https://developers.openai.com/plugins/build/plugins .
