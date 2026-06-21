# Homebrew formula for the Sentinel CLI (standalone binary — no Node required).
#
# Ship this from a tap repo (e.g. montanalabs/homebrew-tap) so users can:
#   brew install montanalabs/tap/sentinel
#
# On each release, update `version` and the four `sha256` values to match the GitHub Release assets
# (the release workflow can automate this).
class Sentinel < Formula
  desc "Independent verification & action-gate for AI agents"
  homepage "https://github.com/montanalabs/sentinel"
  version "0.1.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/montanalabs/sentinel/releases/download/v#{version}/sentinel-darwin-arm64"
      sha256 "REPLACE_WITH_DARWIN_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/montanalabs/sentinel/releases/download/v#{version}/sentinel-darwin-x64"
      sha256 "REPLACE_WITH_DARWIN_X64_SHA256"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/montanalabs/sentinel/releases/download/v#{version}/sentinel-linux-arm64"
      sha256 "REPLACE_WITH_LINUX_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/montanalabs/sentinel/releases/download/v#{version}/sentinel-linux-x64"
      sha256 "REPLACE_WITH_LINUX_X64_SHA256"
    end
  end

  def install
    bin.install Dir["*"].first => "sentinel"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/sentinel version")
  end
end
