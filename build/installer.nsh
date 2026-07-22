; electron-builder's default per-user install dir is
; %LOCALAPPDATA%\Programs\${productName}, which lands on C:. This machine's
; convention (see README) is that everything Tomelight writes — the data
; folder, backups — lives under D:\Claude\, so default the suggested install
; location there too. The user can still pick a different folder on the
; "Choose Install Location" page (allowToChangeInstallationDirectory: true);
; this only changes what's pre-filled.
!macro customInit
  StrCpy $INSTDIR "D:\Claude\Tomelight-App"
!macroend
