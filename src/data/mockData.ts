export type TicketStatus = 'Pending Linking' | 'Linked' | 'Processing' | 'Error';
export type TicketType = 'EMD' | '1st' | 'EXCH';
export type TicketSource = 'Airfile' | 'Email' | 'Manual';

export interface Ticket {
  id: string;
  pnr: string;
  ticket: string | null;
  officeId: string | null;
  iata: string | null;
  passengers: string;
  route: string;
  routeDate: string;
  type: TicketType;
  source: TicketSource;
  airline: string;
  fop: string | null;
  amount: number;
  date: string;
  order: string | null;
  status: TicketStatus;
}

export const mockTickets: Ticket[] = [
  { id: '1',  pnr: 'B3YJ6C', ticket: null,           officeId: 'EWR1S21EF', iata: '33535983', passengers: 'EICHLER/J',              route: 'EWR → JFK', routeDate: '22APR', type: 'EMD',  source: 'Airfile', airline: 'El Al Israel Airlines', fop: null,    amount: 128,    date: '22 Apr 2026, 00:04', order: null,      status: 'Pending Linking' },
  { id: '2',  pnr: 'B3YJ6C', ticket: null,           officeId: 'EWR1S21EF', iata: '33535983', passengers: 'EICHLER/E',              route: 'EWR → JFK', routeDate: '22APR', type: 'EMD',  source: 'Airfile', airline: 'El Al Israel Airlines', fop: null,    amount: 128,    date: '22 Apr 2026, 00:04', order: null,      status: 'Pending Linking' },
  { id: '3',  pnr: 'B3YJ6C', ticket: '114-7478615961', officeId: 'EWR1S21EF', iata: '33535983', passengers: 'EICHLER/E, EICHLER/J', route: 'EWR → JFK', routeDate: '22APR', type: '1st', source: 'Airfile', airline: 'El Al Israel Airlines', fop: 'VI0188', amount: 5876,   date: '21 Apr 2026, 23:57', order: null,      status: 'Pending Linking' },
  { id: '4',  pnr: '73426893893042', ticket: null,    officeId: null,          iata: null,       passengers: 'BEN-ELI/D',             route: '—',         routeDate: '',      type: '1st', source: 'Email',   airline: 'Expedia TAAP',         fop: null,    amount: 245.40, date: '21 Apr 2026, 23:25', order: null,      status: 'Pending Linking' },
  { id: '5',  pnr: '73426893893042', ticket: null,    officeId: null,          iata: null,       passengers: 'BEN-ELI/D',             route: '—',         routeDate: '',      type: '1st', source: 'Email',   airline: 'Expedia TAAP',         fop: null,    amount: 245.40, date: '21 Apr 2026, 23:25', order: null,      status: 'Pending Linking' },
  { id: '6',  pnr: '—',      ticket: null,           officeId: null,          iata: null,       passengers: 'R/J',                   route: '—',         routeDate: '',      type: '1st', source: 'Email',   airline: 'Nesiah Travel',        fop: null,    amount: 0,      date: '21 Apr 2026, 22:31', order: null,      status: 'Pending Linking' },
  { id: '7',  pnr: '—',      ticket: null,           officeId: null,          iata: null,       passengers: 'R/J',                   route: '—',         routeDate: '',      type: '1st', source: 'Email',   airline: 'Nesiah Travel',        fop: null,    amount: 0,      date: '21 Apr 2026, 22:31', order: null,      status: 'Pending Linking' },
  { id: '8',  pnr: 'CDFNNC', ticket: '006-7478615787', officeId: 'EWR1S21EF', iata: '33535983', passengers: 'BEN ELI/D',             route: 'LGA → FLL', routeDate: '21APR', type: '1st', source: 'Airfile', airline: 'Delta Air Lines',      fop: 'AX2001', amount: 494.40, date: '21 Apr 2026, 17:25', order: null,      status: 'Pending Linking' },
  { id: '9',  pnr: 'A38NQN', ticket: null,           officeId: 'EWR1S21EF', iata: '33535983', passengers: 'LANDAU/S',               route: 'EWR → TLV', routeDate: '21APR', type: 'EXCH', source: 'Airfile', airline: 'El Al Israel Airlines', fop: null,    amount: 0,      date: '21 Apr 2026, 16:54', order: null,      status: 'Pending Linking' },
  { id: '10', pnr: 'A38NQN', ticket: null,           officeId: 'EWR1S21EF', iata: '33535983', passengers: 'LANDAU/S',               route: '—',         routeDate: '',      type: 'EXCH', source: 'Airfile', airline: 'El Al Israel Airlines', fop: null,    amount: 0,      date: '21 Apr 2026, 16:54', order: null,      status: 'Pending Linking' },
  { id: '11', pnr: 'A38NQN', ticket: null,           officeId: 'EWR1S21EF', iata: '33535983', passengers: 'KLEIN/M',                route: 'EWR → TLV', routeDate: '21APR', type: 'EXCH', source: 'Airfile', airline: 'El Al Israel Airlines', fop: null,    amount: 0,      date: '21 Apr 2026, 16:54', order: null,      status: 'Linked' },
  { id: '12', pnr: 'XK9PQR', ticket: '220-1234567890', officeId: 'EWR1S21EF', iata: '33535983', passengers: 'GOLDMAN/A',            route: 'JFK → LAX', routeDate: '20APR', type: '1st', source: 'Airfile', airline: 'United Airlines',      fop: 'MC3301', amount: 889.00, date: '20 Apr 2026, 15:10', order: 'ORD-881', status: 'Linked' },
  { id: '13', pnr: 'ZM3KLW', ticket: null,           officeId: null,          iata: null,       passengers: 'STERN/R',               route: 'TLV → NYC', routeDate: '19APR', type: '1st', source: 'Manual',  airline: 'El Al Israel Airlines', fop: null,    amount: 1240,   date: '19 Apr 2026, 09:45', order: null,      status: 'Processing' },
  { id: '14', pnr: 'HQ7FBN', ticket: '117-9988776655', officeId: 'EWR1S21EF', iata: '33535983', passengers: 'WEISS/D, WEISS/M',     route: 'EWR → MIA', routeDate: '18APR', type: 'EMD',  source: 'Email',   airline: 'American Airlines',    fop: 'VI5544', amount: 320,    date: '18 Apr 2026, 11:22', order: 'ORD-765', status: 'Error' },
];

export const stats = {
  total: 1288,
  pending: 436,
  processed: 441,
  errors: 0,
};
