---
name: jira-cli
description: Interactive CLI for Atlassian Jira (ankitpokhrel/jira-cli). Helps manage issues, epics, sprints, and releases directly from the terminal with a TUI or plain text output.
license: MIT
---

# JiraCLI Guide

## Overview

`jira-cli` is a feature-rich interactive command line tool for Atlassian Jira. It allows you to search, view, create, and transition issues without using the Jira web UI. It supports Jira Cloud and Jira Server (on-premise).

## Quick Start

### Installation

```bash
# Using Homebrew
brew install ankitpokhrel/jira-cli/jira

# Using Docker
docker run -it --rm ghcr.io/ankitpokhrel/jira-cli:latest
```

### Configuration

1. **Get an API Token**: [Create one here](https://id.atlassian.com/manage-profile/security/api-tokens).
2. **Export Token**: 
   ```bash
   export JIRA_API_TOKEN="your_token_here"
   ```
3. **Initialize**: 
   ```bash
   jira init
   ```
   Follow the prompts to select Cloud/Local and provide your site URL, project, etc.

## Common Commands

### Issue Management

#### List Issues
```bash
# Interactive TUI list
jira issue list

# Filtered list
jira issue list -s"To Do" -yHigh --created -7d

# Plain text output (useful for scripts)
jira issue list --plain

# Using JQL
jira issue list -q "summary ~ 'bug' AND status = 'In Progress'"
```

#### Create & Edit
```bash
# Create interactively
jira issue create

# Create with flags (non-interactive)
jira issue create -tBug -s"Critical Fix" -yHigh -b"Description" --no-input

# Edit an issue
jira issue edit PROJ-123 -s"Updated Summary" --no-input
```

#### View & Transition
```bash
# View details in terminal
jira issue view PROJ-123

# Move/Transition status
jira issue move PROJ-123 "In Progress"

# Assign to self
jira issue assign PROJ-123 $(jira me)
```

#### Comments & Worklogs
```bash
# Add comment
jira issue comment add PROJ-123 "Finished the investigation."

# Add worklog
jira issue worklog add PROJ-123 "2h 30m" --comment "Implementing the fix"
```

### Epic & Sprint Management

#### Epics
```bash
# List epics
jira epic list

# Add issues to epic
jira epic add EPIC-123 PROJ-456 PROJ-789
```

#### Sprints
```bash
# List issues in current active sprint
jira sprint list --current

# Add issues to sprint
jira sprint add SPRINT_ID PROJ-456
```

## Navigation (TUI Mode)

| Key | Action |
|-----|--------|
| `j`/`k` | Navigate down/up |
| `v` | View selected issue |
| `m` | Move/Transition selected issue |
| `Enter` | Open in browser |
| `c` | Copy issue URL |
| `q` | Quit |
| `?` | Open help |

## Advanced Usage

### Environment Variables
- `JIRA_API_TOKEN`: Your API token.
- `JIRA_CONFIG_FILE`: Path to a specific config file.
- `JIRA_AUTH_TYPE`: Set to `bearer` for Personal Access Tokens.

### Scripting with `--plain`
```bash
# Get count of tickets created this month
jira issue list --created month --plain --no-headers | wc -l
```

## References
- GitHub Repository: [ankitpokhrel/jira-cli](https://github.com/ankitpokhrel/jira-cli)
- Documentation: [Wiki](https://github.com/ankitpokhrel/jira-cli/wiki)
