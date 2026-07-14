// Non-standard but widely-supported file input attributes (Chrome/Edge/Firefox/Safari)
// used to enable whole-folder selection for the "Load Folder" sample import flow.
// Not part of the HTML spec, so React's built-in typings omit them.
import 'react';

declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}
