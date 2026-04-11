#!/bin/bash
# extract_project_info.sh - Automates data gathering for README generation

echo "### PROJECT INFO EXTRACTION ###"

# Android Package Name & Signing
if [ -f "./gradlew" ]; then
    echo "--- Android Targets ---"
    # Execute signingReport to get SHA1/SHA256
    ./gradlew signingReport > signing_temp.txt
    
    # Extract unique Application IDs from gradle files
    grep -r "applicationId" . --include="*.gradle*" | sed -E 's/.*applicationId ["'\''](.*)["'\'']/\1/' | sort -u | while read -r line; do
        echo "Package Name: $line"
    done
    
    # Extract SHA1 from Release variants in the report
    echo "--- Signing Fingerprints (Release) ---"
    awk '/Variant: .*Release/ {p=1; print $0} p && /SHA1:/ {print $0; p=0} p && /----------/ {p=0}' signing_temp.txt
    
    rm signing_temp.txt
fi

# iOS Bundle ID & Team ID Extraction
echo "--- iOS Targets ---"
# Look for PRODUCT_BUNDLE_IDENTIFIER in pbxproj files
find . -name "project.pbxproj" -exec grep "PRODUCT_BUNDLE_IDENTIFIER =" {} \; | sed -E 's/.*= (.*);/\1/' | sort -u | while read -r line; do
    echo "Bundle ID: $line"
done

# Look for DEVELOPMENT_TEAM in pbxproj files
find . -name "project.pbxproj" -exec grep "DEVELOPMENT_TEAM =" {} \; | sed -E 's/.*= (.*);/\1/' | sort -u | while read -r line; do
    echo "Team ID: $line"
done

# KMP Targets detection
if [ -f "build.gradle.kts" ] && grep -q "kotlin(\"multiplatform\")" build.gradle.kts; then
    echo "--- KMP Targets Detected ---"
    grep -E "androidTarget|iosX64|iosArm64|iosSimulatorArm64|jvm|js|wasm" build.gradle.kts | sed -E 's/^[[:space:]]*//' | cut -d'(' -f1 | sort -u
fi
