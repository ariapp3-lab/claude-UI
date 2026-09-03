import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import DataPumpPage from './pages/DataPumpPage';
import DashboardPage from './pages/DashboardPage';
import ReconciliationPage from './commission/pages/ReconciliationPage';
import CheckTicketPage from './commission/pages/CheckTicketPage';
import ContractPage from './commission/pages/ContractPage';
import StatementPage from './commission/pages/StatementPage';
import { WorkspaceProvider } from './commission/workspace';

type Page = string;

export default function App() {
  const [activePage, setActivePage] = useState<Page>('Reconciliation');

  const renderPage = () => {
    switch (activePage) {
      case 'Reconciliation':  return <ReconciliationPage />;
      case 'Check a ticket':  return <CheckTicketPage />;
      case 'Statements':      return <StatementPage />;
      case 'Contract':        return <ContractPage />;
      case 'Data Pump':       return <DataPumpPage />;
      case 'Dashboard':       return <DashboardPage />;
      default:
        return (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <p className="text-4xl mb-3">🚧</p>
              <p className="text-lg font-medium text-slate-600">{activePage}</p>
              <p className="text-sm text-slate-400 mt-1">This page is coming soon.</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-surface-subtle">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onNewOrder={() => setActivePage('Orders')} />
        <WorkspaceProvider>{renderPage()}</WorkspaceProvider>
      </div>
    </div>
  );
}
