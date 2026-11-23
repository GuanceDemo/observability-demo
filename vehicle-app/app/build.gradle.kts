plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.guance.vehicledemo"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.guance.vehicledemo"
        minSdk = 24
        targetSdk = 36
        versionCode = 5
        versionName = "0.1.4"
        buildConfigField("boolean", "APM_ENABLED", providers.gradleProperty("vehicleApm").orElse("false").get())
        buildConfigField("String", "VEHICLE_CLUSTER", "\"" + providers.gradleProperty("vehicleCluster").orElse("unknown").get() + "\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        create("release") {
            System.getenv("VEHICLE_KEYSTORE")?.let { storeFile = file(it) }
            storePassword = System.getenv("VEHICLE_STORE_PASSWORD")
            keyAlias = "vehicle-demo"
            keyPassword = System.getenv("VEHICLE_KEY_PASSWORD")
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += setOf("META-INF/INDEX.LIST", "META-INF/io.netty.versions.properties") }
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation(platform("io.opentelemetry:opentelemetry-bom:1.54.0"))
    implementation("io.opentelemetry:opentelemetry-sdk")
    implementation("io.opentelemetry:opentelemetry-exporter-otlp")
    implementation("io.opentelemetry:opentelemetry-api-incubator:1.54.0-alpha")
    implementation("com.fasterxml.jackson.core:jackson-core:2.19.2")
    implementation("com.google.auto.value:auto-value-annotations:1.11.0")
    implementation("com.google.errorprone:error_prone_annotations:2.42.0")
    implementation("com.google.code.findbugs:jsr305:3.0.2")
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    ksp("androidx.room:room-compiler:2.7.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-jdk8:1.10.2")
    implementation("com.hivemq:hivemq-mqtt-client:1.4.1")
    implementation(platform("com.hivemq:hivemq-mqtt-client-websocket:1.4.1"))
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.room:room-testing:2.7.2")
}
