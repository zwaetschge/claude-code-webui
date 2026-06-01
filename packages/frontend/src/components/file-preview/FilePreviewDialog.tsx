import { useState, useEffect } from 'react';
import { FileSpreadsheet, FileText, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/services/api';

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string | null;
}

interface CSVPreviewData {
  type: 'csv';
  path: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

interface XLSXPreviewData {
  type: 'xlsx';
  path: string;
  sheets: Record<string, { headers: string[]; rows: string[][]; totalRows: number }>;
  sheetNames: string[];
}

interface JSONPreviewData {
  type: 'json';
  path: string;
  content: unknown;
  size: number;
}

interface TextPreviewData {
  type: 'text';
  path: string;
  content: string;
  size: number;
}

type PreviewData = CSVPreviewData | XLSXPreviewData | JSONPreviewData | TextPreviewData;

interface ApiPreviewResponse {
  success: boolean;
  data?: PreviewData;
}

export function FilePreviewDialog({ open, onOpenChange, filePath }: FilePreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PreviewData | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');

  useEffect(() => {
    if (open && filePath) {
      loadPreview(filePath);
    } else {
      setData(null);
      setError(null);
    }
  }, [open, filePath]);

  const loadPreview = async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<ApiPreviewResponse>(
        `/api/files/preview?path=${encodeURIComponent(path)}`
      );
      if (response.data.success && response.data.data) {
        setData(response.data.data);
        if (response.data.data.type === 'xlsx' && response.data.data.sheetNames.length > 0) {
          setActiveSheet(response.data.data.sheetNames[0] || '');
        }
      } else {
        setError('Failed to load preview');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = () => {
    if (filePath) {
      window.open(`/api/files/binary?path=${encodeURIComponent(filePath)}`, '_blank');
    }
  };

  const getFileName = () => {
    if (!filePath) return '';
    return filePath.split('/').pop() || filePath;
  };

  const getIcon = () => {
    if (!data) return <FileText className="h-5 w-5" />;
    switch (data.type) {
      case 'csv':
      case 'xlsx':
        return <FileSpreadsheet className="h-5 w-5" />;
      default:
        return <FileText className="h-5 w-5" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {getIcon()}
            <span className="truncate">{getFileName()}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={() => filePath && loadPreview(filePath)}>
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {(data.type === 'csv' || data.type === 'xlsx') && (
                <DataTablePreview
                  data={data}
                  activeSheet={activeSheet}
                  onSheetChange={setActiveSheet}
                />
              )}

              {data.type === 'json' && (
                <ScrollArea className="h-[calc(80vh-150px)]">
                  <pre className="p-4 text-sm font-mono bg-muted rounded-lg overflow-auto">
                    {JSON.stringify(data.content, null, 2)}
                  </pre>
                </ScrollArea>
              )}

              {data.type === 'text' && (
                <ScrollArea className="h-[calc(80vh-150px)]">
                  <pre className="p-4 text-sm font-mono bg-muted rounded-lg whitespace-pre-wrap">
                    {data.content}
                  </pre>
                </ScrollArea>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 flex justify-between items-center pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {data?.type === 'csv' &&
              `${data.totalRows} rows${data.truncated ? ' (showing first 100)' : ''}`}
            {data?.type === 'xlsx' && `${data.sheetNames.length} sheet(s)`}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadFile}>
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DataTablePreviewProps {
  data: CSVPreviewData | XLSXPreviewData;
  activeSheet: string;
  onSheetChange: (sheet: string) => void;
}

function DataTablePreview({ data, activeSheet, onSheetChange }: DataTablePreviewProps) {
  const getTableData = () => {
    if (data.type === 'csv') {
      return { headers: data.headers, rows: data.rows };
    } else {
      const sheet = data.sheets[activeSheet];
      return sheet ? { headers: sheet.headers, rows: sheet.rows } : { headers: [], rows: [] };
    }
  };

  const { headers, rows } = getTableData();

  return (
    <div className="flex flex-col h-full">
      {data.type === 'xlsx' && data.sheetNames.length > 1 && (
        <Tabs value={activeSheet} onValueChange={onSheetChange} className="shrink-0 mb-2">
          <TabsList>
            {data.sheetNames.map((name) => (
              <TabsTrigger key={name} value={name} className="text-xs">
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <ScrollArea className="flex-1 border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b w-10">
                #
              </th>
              {headers.map((header, i) => (
                <th key={i} className="px-3 py-2 text-left font-medium border-b whitespace-nowrap">
                  {header || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-muted/50">
                <td className="px-3 py-2 text-muted-foreground border-b text-xs">{rowIndex + 1}</td>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 border-b max-w-xs truncate" title={cell}>
                    {cell}
                  </td>
                ))}
                {/* Fill empty cells if row has fewer columns than headers */}
                {Array.from({ length: Math.max(0, headers.length - row.length) }).map((_, i) => (
                  <td key={`empty-${i}`} className="px-3 py-2 border-b" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-8 text-center text-muted-foreground">No data</div>}
      </ScrollArea>
    </div>
  );
}

export default FilePreviewDialog;
