'use client';

import { useEffect } from 'react';

import { RESIZE_MESSAGE } from '@/lib/embedding';

/**
 * Inside a frame, tell the page around it how tall the form is, so its
 * resize script can grow the frame to fit and nobody scrolls inside a box.
 * Only the height and the form's address are sent, which say nothing about
 * what anybody typed. Outside a frame it does nothing.
 */
export function FrameResize({ slug }: { slug: string }) {
  useEffect(() => {
    if (window.parent === window) return;
    // Lets a form set to show the host page through it drop its own
    // background, only when it is in a frame.
    document.documentElement.dataset.framed = '';
    // The page's own content, not the document: a document is never shorter
    // than the frame it is in, so measuring it would let the frame grow but
    // never shrink, as it must when the form is replaced by the confirmation.
    const content = document.querySelector('main') ?? document.body;
    const send = () =>
      window.parent.postMessage(
        {
          type: RESIZE_MESSAGE,
          form: slug,
          height: Math.ceil(
            content.getBoundingClientRect().bottom + window.scrollY
          )
        },
        '*'
      );
    send();
    const observer = new ResizeObserver(send);
    observer.observe(content);
    return () => observer.disconnect();
  }, [slug]);
  return null;
}
