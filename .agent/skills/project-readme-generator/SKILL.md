---
name: project-readme-generator
description: This skill should be used when a user needs to generate or update a README.md file for a mobile (Android/iOS) or Kotlin Multiplatform (KMP) project. It automates the extraction of project metadata such as Package Names, Bundle IDs, Team IDs, and Signing Fingerprints (SHA1) required for Firebase/Google Cloud setup.
---

# Project Readme Generator

## Overview

This skill enables the automated generation of technical README files for mobile and KMP projects. It ensures that critical information like Application IDs, iOS Team IDs, and signing certificates are accurately documented in a standardized format.

## Workflow

To generate a project README, follow these steps:

### 1. Project Exploration
Identify the project type by checking for core files:
- **Android**: `build.gradle`, `settings.gradle`, `app/` directory.
- **iOS**: `Podfile`, `.xcodeproj`, `project.pbxproj`.
- **KMP**: `build.gradle.kts` with `kotlin("multiplatform")` plugin.

### 2. Data Extraction
Use the provided script to gather technical details:
- Run `bash scripts/extract_project_info.sh` from the project root.
- This will output Package Names/Bundle IDs, iOS Team IDs, and SHA1 fingerprints for Android variants.

### 3. Stack Identification
Analyze the project dependencies to fill the "Technologies" section:
- **Android**: Check `implementation` lines in `build.gradle`.
- **iOS**: Check `Podfile` or Swift Package dependencies.
- **KMP**: Check `commonMain` dependencies in `build.gradle.kts`.

### 4. Template Selection
Always use the Catalan template as the primary choice for this project environment:
- **Mandatory**: Use `references/template_ca.md`. All README files must be generated in Catalan.

### 5. Document Generation
Generate the `README.md` file in **Catalan** combining the extracted data with the template. Ensure the following sections are present:
- **Product Flavors / Targets**: A table mapping flavors to their Application IDs and Team IDs (for iOS).
- **Signing Config**: A dedicated section for Firebase/Google Cloud metadata (Package Name + SHA1 / Team ID).

## Examples

### User Request: "Create a README for this iOS app"
1. Run `extract_project_info.sh`.
2. Map the `Bundle ID` and `Team ID` output to the "Signing Config" section.
3. Identify the main dependencies from the `Podfile`.
4. Write the `README.md` using the Catalan template if requested.

### User Request: "I need the SHA1 and package name for Firebase in the README"
1. Run `signingReport` (or the extraction script).
2. Locate the `Release` variant.
3. Update the `README.md` focusing on the "Configuració de Signat" section.

## Resources

### scripts/
- `extract_project_info.sh`: Automates the extraction of Application IDs and signing fingerprints.

### references/
- `template_ca.md`: Standard Catalan template for project documentation.
