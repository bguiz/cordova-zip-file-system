'use strict';

(function(global) {
  if (!global.zip) {
    throw 'zip library is unavailable - cannot continue';
  }
  var zip = global.zip;

  global.CordovaZipFileSystem = global.CordovaZipFileSystem || {};

  global.CordovaZipFileSystem.directory = {
    makeRecursive: directory_makeRecursive,
    makeTree: directory_makeTree,
    copyRecursive: directory_copyRecursive,
    get: directory_get,
    
    _initialise: directory_initialise,
  };

  /**
   * Make a directory recursively
   *
   * @param  {DirectoryEntry}   fsRoot File system root:
   *   http://docs.phonegap.com/en/edge/cordova_file_file.md.html#DirectoryEntry
   *   http://docs.phonegap.com/en/edge/cordova_file_file.md.html#FileSystem
   * @param  {String} path      The path of the directory, relative to file system root
   * @param  {Function} onDone  Callback
   */
  function directory_makeRecursive(fsRoot, path, onDone) {
      var dirs = path.split('/').reverse();

      function mkdirSub(dirEntry) {
        if (dirs.length > 0) {
          var dir;
           do {
            dir = dirs.pop();
           } while (!dir);
          mkdir(fsRoot, dir, onCreateDirSuccess, onCreateDirFailure);
        }
        else {
          console.log('mkdir -p OK', path, dirEntry);
          onDone(undefined, dirEntry);
        }
      }

      function onCreateDirSuccess(dirEntry) {
        // console.log('mkdir OK ', dirEntry.fullPath);
        fsRoot = dirEntry;
        mkdirSub(dirEntry);
      }

      function onCreateDirFailure(err) {
        console.log('mkdir fail', err, !!err && err.stack);
        throw err;
      }

      mkdir(fsRoot, dirs.pop(), onCreateDirSuccess, onCreateDirFailure);
  }

  function _regular_mkdir(fsRoot, dirPath, onCreateDirSuccess, onCreateDirFailure) {
    // console.log('mkdir', dirPath);
    fsRoot.getDirectory(dirPath, {
      create : true,
      exclusive : false,
    }, onCreateDirSuccess, onCreateDirFailure);
  }

  function _windows_mkdir(fsRoot, dirPath, onCreateDirSuccess, onCreateDirFailure) {
    // console.log('mkdir-windows', dirPath);
    dirPath = dirPath.replace(/\//g, '\\');
    if (dirPath.match(/\.js$/i)) {
      throw 'Directory ending with .js';
    }
    fsRoot
      .createFolderAsync(dirPath, global.Windows.Storage.CreationCollisionOption.openIfExists)
      .then(onCreateDirSuccess, onCreateDirFailure);
  }

  function directory_get(fsRoot, path, onDone) {
    fsRoot.tryGetItemAsync(path.replace(/\//g, '\\'))
      .then(function onGotDirectory(testDir) {
        onDone(undefined, testDir);
      }, function onGetDirectoryFailed(err) {
        onDone(err);
      });
  }

  function directory_copyRecursive(fsRootSource, source, fsRootDest, dest, onDone) {
    // var numFods = 0;
    var numFiles = 0;
    var numFilesWritten = 0;
    var numFilesErrored = 0;
    var numFolders = 0;
    var numFoldersWritten = 0;
    var numFoldersErrored = 0;
    var replaceFlag = Windows.Storage.CreationCollisionOption.replaceExisting;
    
    source = source.replace(/\//g, '\\');
    dest = dest.replace(/\//g, '\\');

    fsRootSource
      .getFolderAsync(source)
      .then(function onGotSourceDir(srcDir) {
        directory_get(fsRootDest, dest, function onTestDestExists(err, testDestFolder) {
          // ignore any errors
          if (!!testDestFolder) {
            // Remove it
            testDestFolder.deleteAsync()
              .then(function onDeleted() {
                mkdirDestAndCopyIntoIt();
              }, function onDeleteFailed() {
                onDone('Destination directory already exists, and could not be deleted: ' + testDestFolder.path);
              });
          }
          else {
            mkdirDestAndCopyIntoIt();
          }
        });
        function mkdirDestAndCopyIntoIt() {
          directory_makeRecursive(fsRootDest, dest, function onMkdirpDest(err, destFolder) {
            if (!!err) {
              onDone(err);
              return;
            }
            console.log('cp -r ', srcDir.path, destFolder.path);
            copyFolders(srcDir, destFolder);
          });
        }
      })
    .then(undefined, function onErr(err) {
      console.log('Source:', source, 'Dest:', dest);
      console.error('Err:', err);
    });

    function copyFolders(from, destFolder) {
      if (!from) {
        throw 'Invalid from directory';
      }
      if (!destFolder) {
        throw 'Invalid dest directory';
      }

      var checkedFiles = false;
      var checkedFolders = false;
      copySubFiles();
      copySubFolders();

      function copySubFiles() {
        from
        .getFilesAsync()
        .then(function onGotFiles(files) {
          checkedFiles = true;
          if (!!files) {
            numFiles += files.length;
            files.forEach(function onFile(result) {
              console.log("copy file: " + result.name);
              result
                .copyAsync(destFolder, result.name, replaceFlag)
                .then(function onFileCopied() {
                  ++numFilesWritten
                  checkComplete();
                }, function onFileCopyError(err) {
                  console.error('Err', result, err);
                  ++numFilesErrored;
                  checkComplete();
                });
            });
          }
        }, function onFileCopyError(err) {
          console.error('Err', err);
        });
      }

      function copySubFolders() {
        from
        .getFoldersAsync()
        .then(function onGotFolders(folders) {
          checkedFolders = true;
          numFolders += folders.length;
          if (folders.length === 0) {
            checkComplete();
          }
          folders.forEach(function onFolder(folder) {
            console.log('create folder: ' + folder.name);
            destFolder
              .createFolderAsync(folder.name, replaceFlag)
              .then(function onCreatedParallelFolder(newFolder) {
                ++numFoldersWritten;
                copyFolders(folder, newFolder);
                // checkComplete();
              }, function onFolderCreateError(err) {
                console.error('Err', err);
                ++numFoldersErrored;
              });
          });
        }, function onGotFoldersError(err) {
          console.error('Err', err);
        });
      }

      function checkComplete() {
        if (checkedFiles &&
          checkedFolders &&
          numFilesWritten + numFilesErrored >= numFiles &&
          numFoldersWritten + numFoldersErrored >= numFolders) {
          var err;
          if (numFilesErrored + numFoldersErrored > 0) {
            err = 'Number of files or directories errored: ' + (numFilesErrored + numFoldersErrored);
          }
          onDone(err, numFilesWritten + numFoldersWritten);
        }
      }

    }

  }

  function constructTreeFromListOfDirectories(dirs) {
    var tree = {};
    dirs.forEach(function addToTree(dir) {
      var node = tree;
      var segments = dir.split('/');
      for (var i = 0; i < segments.length; ++i) {
        var segment = segments[i];
        if (!node[segment]) {
          node[segment] = {};
        }
        node = node[segment];
      }
    });
    return tree;
  }

  /**
   * Make a list of directories efficiently,
   * by constructing a tree data structure
   *
   * @param  {Array<String>}  dirs               A list of directories that need to be constructed
   * @param  {Function}       onCompleteRootTree Gets called once complete, the first parameter will be an array of errors
   */
  function directory_makeTree(dirs, onCompleteRootTree) {
    var tree = constructTreeFromListOfDirectories(dirs);

    global.CordovaZipFileSystem.platform.getFileSystemRoot(onGotFileSytem);

    function onGotFileSytem(fileSys) {
      // Now recur through the nodes in the tree, breadth-first search,
      // and mkdir each node in turn
      // This ensures that the minimum number of mkdirs is needed
      var errors = [];

      mkdirTree('', tree, onCompleteRootTree);

      function mkdirTree(path, node, onCompleteTree) {
        var subDirs = Object.keys(node);
        var numSubDirs = subDirs.length;

        if (numSubDirs === 0) {
          // Termination condition
          onCompleteTree();
          return;
        }

        var numLocalAttempts = 0;

        subDirs.forEach(function eachSubDir(subDir) {
          var subDirPath = (path.length > 0) ? path+'/'+subDir : subDir;
          var subNode = node[subDir];

          mkdir(fileSys, subDirPath, function onCreateDirSuccess(dirEntry) {
            // Recur
            mkdirTree(subDirPath, subNode, function onCompleteSubTree() {
              ++numLocalAttempts;
              if (numLocalAttempts >= numSubDirs) {
                onCompleteTree(errors);
              }
            });
          }, function onCreateDirFailure(err) {
            ++numLocalAttempts;
            errors.push({
              err: err,
              path: path,
              subDir: subDir,
            });
            if (numLocalAttempts >= numSubDirs) {
              onCompleteTree(errors);
            }
          });
        });
      }
    }
  }

  var mkdir;

  function directory_initialise(platformCategory) {
    if (platformCategory === 'windows') {
      mkdir = _windows_mkdir;
    }
    else {
      mkdir = _regular_mkdir;
    }

    global.CordovaZipFileSystem.directory.mkdir = mkdir;
  }
})(this);
