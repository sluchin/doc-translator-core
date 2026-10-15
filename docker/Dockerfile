# 開発用のイメージ (dev). PC (Linux) の Tauri アプリと Android の APK をどちらもビルドできる.
FROM ubuntu:24.04 AS dev

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Tauri (Linux) のビルドに要るライブラリ, JDK 17 (Android), Node.js 用の道具
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    git \
    file \
    unzip \
    xz-utils \
    pkg-config \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libxdo-dev \
    patchelf \
    openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Rust (ツールチェインは読み取り専用. cargo のキャッシュはボリュームの /cargo-home)
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/cargo-home
ENV PATH=/usr/local/cargo/bin:${PATH}
RUN curl -fsSL https://sh.rustup.rs | CARGO_HOME=/usr/local/cargo sh -s -- -y --profile minimal \
        -t aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android \
        -c clippy,rustfmt && \
    chmod -R a+rX /usr/local/rustup /usr/local/cargo
RUN mkdir -p /cargo-home && chmod 777 /cargo-home

# Android SDK と NDK (Tauri の Android ビルド用). Gradle が足りない部品を入れられるよう, 書き込める
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV NDK_VERSION=27.2.12479018
ENV NDK_HOME=/opt/android-sdk/ndk/27.2.12479018
ARG CMDLINE_TOOLS=16111833
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && \
    curl -fL -o /tmp/cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip && \
    unzip -q /tmp/cmdtools.zip -d ${ANDROID_HOME}/cmdline-tools && \
    mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && \
    rm /tmp/cmdtools.zip
ENV PATH=${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}
RUN yes | sdkmanager --licenses > /dev/null && \
    sdkmanager "platform-tools" "platforms;android-36" "platforms;android-37.0" "build-tools;35.0.0" "build-tools;36.0.0" "ndk;${NDK_VERSION}" && \
    chmod -R a+rwX ${ANDROID_HOME}

# Gradle と npm のキャッシュ (ボリューム)
ENV GRADLE_USER_HOME=/gradle-home
ENV npm_config_cache=/npm-cache
RUN mkdir -p /gradle-home /npm-cache && chmod 777 /gradle-home /npm-cache

RUN git config --system --add safe.directory '*'

WORKDIR /workspace
