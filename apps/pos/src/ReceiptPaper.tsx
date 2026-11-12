import { ScrollArea } from '@mantine/core';
import type { ReactNode } from 'react';

/** A receipt or report drawn like the 80 mm paper it prints on. Styled in app.css. */
export function ReceiptPaper({ children }: { children: ReactNode }) {
  return (
    <ScrollArea.Autosize mah="60vh" offsetScrollbars>
      <div className="receipt-paper">{children}</div>
    </ScrollArea.Autosize>
  );
}
