# jira-cli auth: pull API token from macOS keychain on demand.
#
# Token is stored with:
#   security add-generic-password -a "$USER" -s jira-cli -w "<token>" -U
# Rotate at https://id.atlassian.com/manage-profile/security/api-tokens
#
# We don't export JIRA_API_TOKEN globally; instead `jira` is a wrapper
# that loads it just-in-time so the token stays out of `env` / child processes
# that don't need it.

if status is-interactive; and command -q jira
    function jira --wraps=jira --description 'jira-cli with token loaded from keychain'
        set -lx JIRA_API_TOKEN (security find-generic-password -a "$USER" -s jira-cli -w 2>/dev/null)
        if test -z "$JIRA_API_TOKEN"
            echo "jira: no token in keychain (service=jira-cli). See ~/.pi/agent/skills/jira/SKILL.md" >&2
            return 1
        end
        command jira $argv
    end
end
