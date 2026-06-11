## ADDED Requirements

### Requirement: PyPI mirror multi-level fallback
The system SHALL attempt pip installation through a chain of PyPI mirror sources. When a mirror fails, the system SHALL automatically retry with the next mirror in the chain. The fallback chain SHALL be: Tsinghua mirror → Aliyun mirror → Official PyPI.

#### Scenario: First mirror succeeds
- **WHEN** pip install is executed with Tsinghua mirror
- **AND** the installation succeeds
- **THEN** the system SHALL proceed without trying other mirrors

#### Scenario: First mirror fails, second succeeds
- **WHEN** pip install fails with Tsinghua mirror
- **THEN** the system SHALL delete the venv directory, recreate it, and retry with Aliyun mirror
- **AND** if Aliyun mirror succeeds, the system SHALL proceed normally

#### Scenario: All mirrors fail
- **WHEN** pip install fails with all three mirrors
- **THEN** the system SHALL report the last error to the user with a descriptive message

### Requirement: PyTorch mirror fallback for extra index URL
When installing packages that require PyTorch (whisperx, whisper), the system SHALL append `--extra-index-url` pointing to a PyTorch mirror. The PyTorch mirror chain SHALL be: SJTU mirror → Official PyTorch download. The system SHALL determine which dependencies require PyTorch based on a declaration in `DEP_REGISTRY`.

#### Scenario: Installing whisperx with PyTorch mirror
- **WHEN** the system installs whisperx
- **THEN** pip SHALL receive `--extra-index-url https://mirror.sjtu.edu.cn/pytorch-wheels/cpu` (or equivalent mirror)

#### Scenario: PyPI mirror fallback retries entire chain including PyTorch
- **WHEN** a pip install with PyTorch extra index fails
- **THEN** the system SHALL fall through to the next PyPI mirror while keeping the PyTorch extra index
- **AND** if all PyPI mirrors fail, the system SHALL retry with official PyTorch as extra index

### Requirement: Mirror configuration
Each mirror source SHALL be defined with: URL, trusted host (if needed), and an optional `--extra-index-url`. The mirror chain SHALL be a constant array in `dependency-manager.ts`, ordered by priority.

#### Scenario: Mirror chain definition
- **WHEN** the system initializes
- **THEN** a `MIRROR_CHAIN` constant SHALL exist containing at least 3 PyPI mirror entries and 2 PyTorch extra index entries
