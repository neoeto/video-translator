## ADDED Requirements

### Requirement: Real-time pip download progress
The system SHALL parse pip's `--progress-bar json` stderr output to extract real download progress, and emit this progress to the frontend via the existing `onProgress` callback and `deps:progress` IPC channel.

#### Scenario: Download progress updates during installation
- **WHEN** pip downloads a package
- **THEN** the system SHALL parse each JSON progress line from pip's stderr
- **AND** emit `DepInstallProgress` with an updated `percent` reflecting the actual download progress

#### Scenario: pip output is not parseable JSON
- **WHEN** a stderr line from pip is not valid JSON progress output
- **THEN** the system SHALL ignore that line and continue processing subsequent lines

### Requirement: Enhanced runCommand with streaming output
The `runCommand` function SHALL be enhanced to accept an optional `onStderr` callback for line-by-line stderr processing. The function SHALL also accept an optional `env` parameter to inject environment variables into the child process.

#### Scenario: Streaming stderr for progress parsing
- **WHEN** `runCommand` is called with an `onStderr` callback
- **THEN** each complete stderr line SHALL be passed to the callback before being appended to the stderr buffer

#### Scenario: Environment variable injection for proxy
- **WHEN** `runCommand` is called with an `env` parameter containing `HTTPS_PROXY`
- **THEN** the spawned child process SHALL have `HTTPS_PROXY` set in its environment

### Requirement: Proxy passthrough to pip
The system SHALL read proxy configuration from `AppConfig` (`proxyEnabled`, `proxyUrl`) and pass `HTTP_PROXY`/`HTTPS_PROXY` environment variables to all pip commands.

#### Scenario: Proxy enabled in settings
- **WHEN** `config.proxyEnabled` is `true` and `config.proxyUrl` is non-empty
- **THEN** all pip commands SHALL receive `HTTPS_PROXY` and `HTTP_PROXY` environment variables set to `config.proxyUrl`

#### Scenario: Proxy disabled
- **WHEN** `config.proxyEnabled` is `false`
- **THEN** no proxy environment variables SHALL be injected

### Requirement: Installation failure cleanup and retry
When a pip install command fails, the system SHALL delete the entire venv directory, recreate it, and retry with the next mirror in the fallback chain. The progress SHALL reflect the retry attempt in the `message` field.

#### Scenario: Install failure triggers cleanup
- **WHEN** `pip install` exits with a non-zero code
- **THEN** the system SHALL delete `{userData}/.venv` recursively
- **AND** recreate the venv from scratch
- **AND** retry installation with the next mirror source

#### Scenario: Retry progress message
- **WHEN** the system retries after a failure
- **THEN** the `DepInstallProgress.message` SHALL indicate the retry attempt (e.g., "Retrying with alternate mirror...")
