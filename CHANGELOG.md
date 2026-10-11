# Changelog

## 1.3.0

### Added

- **Similar images.** The Duplicates view now also finds images that look almost the same, such as resized copies and series of screenshots.
- **Installers you no longer need.** Dropzone notices installers for apps that are already installed.
- **Archives you already extracted.** ZIP archives whose contents already sit next to them are suggested for removal, and any ZIP archive can be extracted with one click.
- **One by one.** Go through loose files one at a time with a large preview, a suggested destination and single-key actions.
- **Quick preview.** Press `Space` to look at images, videos, audio, PDFs, text and code inside Dropzone.
- **Rename and batch rename.** Rename one file, or many with a pattern or find and replace, with a preview and Undo.
- **Rules from your moves.** After moving files into a folder, Dropzone offers to turn it into a rule.
- **Weekly cleanup.** Rules that move files to the Trash can run once a week on their own.
- **Menu bar icon and notifications.** See how many files wait to be sorted, and get a notification when Dropzone sorts or cleans up on its own. Closing the window keeps Dropzone running there.
- **Drag files out.** Drag files from Dropzone into other apps.
- **Monthly summary.** The overview shows how many files Dropzone sorted and how much space it freed in the last 30 days.

## 1.2.0

### Added

- **Delete immediately.** Remove files without going through the Trash. Choose **Delete Immediately** from the menu, or press `⌥⌘⌫` on macOS and `Shift+Delete` on Windows and Linux.
- **Skip the Trash everywhere.** Set **Removing files** in Settings to **Delete immediately**, and removing files, cleaning up duplicates and Trash rules delete right away. Dropzone always asks first, since deleted files can't be restored.

### Improved

- **Clearer segmented controls.** The selected option stands out better in dark appearance.

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
