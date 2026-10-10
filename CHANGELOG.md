# Changelog

## 1.1.0

### Added

- **Windows and Linux.** Dropzone now runs on Windows 10 and 11 and on 64-bit Linux, with a Windows installer, a DEB package and an AppImage.
- **Uses each system's own bin.** Files go to the Recycle Bin on Windows and the Trash on Linux, and Undo brings them back from there.
- **Download sources everywhere.** The site a file came from is read from Windows and Linux file metadata too.
- **Familiar shortcuts.** On Windows and Linux, the usual `Ctrl` shortcuts work, `Delete` moves files to the Recycle Bin and Settings sit at the bottom of the sidebar.

### Improved

- **Hidden and system files.** Files Windows marks as hidden, such as `desktop.ini` and `Thumbs.db`, stay out of the way.
- **Version in Settings.** Settings now show which version of Dropzone you have.

## 1.0.0

### Added

- **Sort with rules you control.** Ten starting rules sort loose files by kind into folders like Images, Documents and Installers. You can edit them, add your own and change their order.
- **Review before anything moves.** Every sort opens a preview grouped by destination. You can leave out single files, and files that would clash with an existing name get a number instead of replacing anything.
- **Undo from History.** Every change is recorded. Undo puts files back where they were, including files moved to the Trash, and tells you plainly when something can no longer be restored.
- **Find exact duplicates.** Dropzone compares file contents, so renamed copies are found too. One copy of each always stays.
- **See what you have.** Files are recognized by what they are, not only by their name, including screenshots, unfinished downloads and files without an extension. The download source is shown when macOS recorded it.
- **Code projects stay intact.** Files inside folders that look like code projects are never sorted or treated as duplicates, and moving them by hand asks first.
- **Sort new files automatically.** Optional for each folder. Only files that arrive after you turn it on are sorted, and rules that move files to the Trash never run on their own.
- **Search and browse.** Search by name, kind or source, filter by kind, and see details for any file in the inspector.
- **Stays on this Mac.** No account, no analytics and no network access.
