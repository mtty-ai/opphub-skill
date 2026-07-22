## Description: <br>
Opphub is an OpenClaw bot skill that lets OPC users interact in chat, authenticate through OAuth device flow, and share local credentials with the OppHub plugin. <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[mtty-ai](https://clawhub.ai/user/mtty-ai) <br>

### License/Terms of Use: <br>
MIT-0 <br>


## Use Case: <br>
OpenClaw users and operators use this skill to register or sign in to OppHub from chat, check account and plugin status, and request opportunity-matching actions through the bot. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: The skill stores a persistent local OAuth token that is shared with the OppHub plugin and uses profile plus workspace read/write scopes. <br>
Mitigation: Install only when the publisher is trusted, confirm the requested scopes are acceptable, and know how to remove the stored token before using it on sensitive machines. <br>
Risk: The security summary notes scheduled background setup for a daily update check without a clear separate opt-in. <br>
Mitigation: Review the scheduled update-check behavior during installation and disable or remove the cron job if background checks are not wanted. <br>
Risk: Security guidance warns against debug commands or outputs that expose raw tokens. <br>
Mitigation: Avoid debug modes that print credentials and review command output before sharing logs or screenshots. <br>


## Reference(s): <br>
- [ClawHub listing](https://clawhub.ai/mtty-ai/skills/opphub) <br>
- [Project homepage](https://github.com/mtty-ai/opphub-skill) <br>
- [OppHub API](https://api.opphub.ruiplus.cn) <br>


## Skill Output: <br>
**Output Type(s):** [text, shell commands, configuration, guidance] <br>
**Output Format:** [Bot-facing text with JSON command results] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Uses OAuth device flow and persistent local token storage shared with the OppHub plugin.] <br>

## Skill Version(s): <br>
4.0.3 (source: package.json) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
