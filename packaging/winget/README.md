# WinGet manifests

These manifests publish the Sentinel CLI to the Windows Package Manager so users can:

```powershell
winget install MontanaLabs.Sentinel
```

## How to publish

WinGet packages live in the community repo [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs),
not here. For each release:

1. Build the manifest set with the official tool (recommended — it computes the SHA256 for you):
   ```powershell
   winget install wingetcreate
   wingetcreate update MontanaLabs.Sentinel `
     --version <X.Y.Z> `
     --urls https://github.com/montanalabs/sentinel/releases/download/v<X.Y.Z>/sentinel-win-x64.exe `
     --submit
   ```
2. `wingetcreate` opens a PR against `microsoft/winget-pkgs`; once merged, `winget install` works.

A first-time package also needs the version/installer/locale manifest trio under
`manifests/m/MontanaLabs/Sentinel/<version>/` in that repo — `wingetcreate new` scaffolds it.

The three files have this shape (filled per release):

- `MontanaLabs.Sentinel.installer.yaml` — `InstallerType: portable`, the `.exe` URL + `InstallerSha256`.
- `MontanaLabs.Sentinel.locale.en-US.yaml` — name, publisher, license (Apache-2.0), description.
- `MontanaLabs.Sentinel.yaml` — the version manifest tying them together.
