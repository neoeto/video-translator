## ADDED Requirements

### Requirement: Embedded Python distribution bundled with app
The system SHALL bundle a Python 3.11 embeddable package as part of the application's `extraResources`. The embeddable Python SHALL be pre-initialized during the build process: `python311._pth` SHALL be modified to enable `site-packages`, and pip SHALL be installed via `get-pip.py`.

#### Scenario: Packaged app contains embedded Python
- **WHEN** the application is installed from the built package
- **THEN** `process.resourcesPath/python/python.exe` (Windows) SHALL exist and be a functional Python 3.11 interpreter with pip available

#### Scenario: Embedded Python is not available (non-Windows or dev mode)
- **WHEN** `process.resourcesPath/python/python.exe` does not exist
- **THEN** the system SHALL fall back to searching for system Python via PATH (`python3`, `python`)

### Requirement: Embedded Python path resolution
The system SHALL expose a function `getEmbeddedPython()` that returns the absolute path to the embedded Python executable if available, or `null` if not. The system SHALL use this function as the primary Python source, with system Python as fallback.

#### Scenario: Windows production build
- **WHEN** running on Windows with embedded Python in `resources/python/`
- **THEN** `getEmbeddedPython()` SHALL return the absolute path to `resources/python/python.exe`

#### Scenario: Development or non-Windows environment
- **WHEN** the embedded Python directory does not exist
- **THEN** `getEmbeddedPython()` SHALL return `null`, and the system SHALL use `findPython()` to locate system Python

### Requirement: Build script for Python embeddable setup
A build script (`scripts/setup-python.ts`) SHALL download Python 3.11 embeddable package for Windows x64, extract it, modify `python311._pth` to enable `site-packages` and `..` path entries, and install pip via `get-pip.py`. The output directory SHALL be `resources/python/`.

#### Scenario: Running the setup script
- **WHEN** `npm run setup-python` is executed
- **THEN** `resources/python/python.exe` SHALL exist and `resources/python/Scripts/pip.exe` SHALL exist

#### Scenario: python311._pth modification
- **WHEN** the setup script completes
- **THEN** `python311._pth` SHALL contain `Lib/site-packages` and import site SHALL be enabled
