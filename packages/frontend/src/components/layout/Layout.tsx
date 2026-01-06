import { useState } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Menu, Plus } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on navigation
  const handleNavigation = () => {
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen bg-background pattern-bg">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <Sidebar onNavigate={handleNavigation} mobile />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between h-14 px-4 border-b bg-card/80 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="h-9 w-9"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Link to="/" className="flex items-center gap-2">
            <img
              src="/claude-logo.png"
              alt="Claude"
              className="h-7 w-7 object-contain"
            />
            <span className="font-semibold text-sm">Claude Code</span>
          </Link>

          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-9 w-9"
          >
            <Link to="/?new=true">
              <Plus className="h-5 w-5" />
            </Link>
          </Button>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
