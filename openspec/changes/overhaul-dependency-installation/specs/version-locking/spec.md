## ADDED Requirements

### Requirement: Locked dependency versions via requirements.lock
The system SHALL install Python dependencies from a `requirements.lock` file located at the project root. This file SHALL contain exact version pins (using `==`) for all direct and transitive dependencies. The system SHALL use `pip install -r requirements.lock` instead of installing individual packages.

#### Scenario: Installation uses locked versions
- **WHEN** `installMissingDeps` installs dependencies
- **THEN** it SHALL execute `pip install -r requirements.lock` with the configured mirror arguments
- **AND** all packages SHALL be installed at their locked versions

#### Scenario: requirements.lock file location
- **WHEN** the system needs the requirements file
- **THEN** it SHALL resolve the path relative to the application's resources or source root

### Requirement: DEP_REGISTRY retains package metadata without version info
`DEP_REGISTRY` SHALL continue to define dependency metadata (id, name, cliName, description, conditions) but SHALL NOT contain version information. Version information SHALL live exclusively in `requirements.lock`.

#### Scenario: DEP_REGISTRY structure unchanged for versions
- **WHEN** a developer adds a new Python dependency
- **THEN** they SHALL add a `DepInfo` entry to `DEP_REGISTRY` for metadata
- **AND** add the package with exact version to `requirements.lock`

### Requirement: requirements.lock content
The `requirements.lock` file SHALL contain at minimum the following direct dependencies with exact versions: `yt-dlp`, `openai-whisper`, `whisperx`, `audio-separator[cpu]`, and all their transitive dependencies needed for correct operation on Python 3.11 Windows x64.

#### Scenario: Lock file covers all required packages
- **WHEN** a fresh venv is created and `pip install -r requirements.lock` is executed
- **THEN** all four CLI tools (`yt-dlp`, `whisper`, `whisperx`, `audio-separator`) SHALL be available and functional
