# Tasks plugin

Portable Agent Plugins package for the authenticated Tasks MCP server. No credentials belong in this package.

Install this folder in a compatible plugin host and connect using OAuth.

For ChatGPT Work, follow the [official quickstart](https://developers.openai.com/plugins/quickstart):

1. Open ChatGPT **Plugins**, select **plus**, then **Add custom MCP server**.
2. Name it Tasks and enter `https://tasks-ultrabricks.vercel.app/api/mcp`.
3. Choose OAuth with dynamic client registration and approve access using your own Tasks identity.
4. Review the risk warning, then select **Create as a plugin**.
5. Open the personal plugin and install it with **plus**.
6. Start a new **Work** chat and invoke `@Tasks`.

Availability and consent depend on the account/workspace. These instructions do not activate an account or establish public directory approval.

If the host requires a registered OpenAI app mapping, register the live endpoint first, then use the actual returned app ID. No placeholder app ID is bundled. The portable mcp.json is directly usable by compatible MCP plugin hosts.

See ../../docs/CHATGPT-CONNECTOR.md for callback configuration, deployment and security details. Source: https://developers.openai.com/plugins/build/plugins .
