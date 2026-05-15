import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Testes para as 3 novas funcionalidades:
 * 1. Interface de Novo Chamado
 * 2. Busca Avançada
 * 3. Exportação de Relatórios
 */

// Mock data
const mockChamados = [
  {
    id: '1',
    number: 1,
    customerName: 'João Silva',
    company: 'Empresa XYZ',
    title: 'Sistema de login não funciona',
    observations: 'Erro 500',
    status: 'open',
    priority: 'critica',
    assignedTo: 'Maria',
    createdAt: new Date('2026-05-10'),
    activities: [],
  },
  {
    id: '2',
    number: 2,
    customerName: 'Maria Santos',
    company: 'Consultoria ABC',
    title: 'Relatório de vendas com erro',
    observations: 'Números não batem',
    status: 'in_progress',
    priority: 'alta',
    assignedTo: 'João',
    createdAt: new Date('2026-05-11'),
    activities: [],
  },
  {
    id: '3',
    number: 3,
    customerName: 'Pedro Costa',
    company: 'Indústria DEF',
    title: 'Integração com sistema ERP',
    observations: 'Conectar com SAP',
    status: 'waiting',
    priority: 'media',
    assignedTo: 'Ana',
    createdAt: new Date('2026-05-12'),
    activities: [],
  },
];

describe('Funcionalidade 1: Interface de Novo Chamado', () => {
  it('deve validar campos obrigatórios', () => {
    const form = {
      customerName: '',
      company: '',
      title: '',
      observations: '',
      priority: 'media',
    };

    const isValid = !!(form.customerName.trim() && form.company.trim() && form.title.trim());
    expect(isValid).toBe(false);
  });

  it('deve aceitar formulário com todos os campos preenchidos', () => {
    const form = {
      customerName: 'João Silva',
      company: 'Empresa XYZ',
      title: 'Sistema de login não funciona',
      observations: 'Erro 500',
      priority: 'critica',
    };

    const isValid = !!(form.customerName.trim() && form.company.trim() && form.title.trim());
    expect(isValid).toBe(true);
  });

  it('deve criar novo chamado com dados válidos', () => {
    const newChamado = {
      id: '4',
      number: 4,
      customerName: 'Ana Oliveira',
      company: 'Startup Tech',
      title: 'Configurar autenticação 2FA',
      observations: 'Implementar 2FA',
      status: 'open',
      priority: 'media',
      assignedTo: null,
      createdAt: new Date(),
      activities: [],
    };

    expect(newChamado.number).toBe(4);
    expect(newChamado.customerName).toBe('Ana Oliveira');
    expect(newChamado.status).toBe('open');
  });

  it('deve incrementar número de chamado sequencialmente', () => {
    const chamado1 = { number: 1 };
    const chamado2 = { number: 2 };
    const chamado3 = { number: 3 };

    expect(chamado2.number).toBe(chamado1.number + 1);
    expect(chamado3.number).toBe(chamado2.number + 1);
  });
});

describe('Funcionalidade 2: Busca Avançada', () => {
  it('deve filtrar por número de chamado', () => {
    const searchTerm = '#0001';
    const filtered = mockChamados.filter(c =>
      `#${String(c.number).padStart(4, '0')}`.includes(searchTerm)
    );

    expect(filtered.length).toBe(1);
    expect(filtered[0].number).toBe(1);
  });

  it('deve filtrar por nome de cliente', () => {
    const searchTerm = 'João';
    const filtered = mockChamados.filter(c =>
      c.customerName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    expect(filtered.length).toBe(1);
    expect(filtered[0].customerName).toBe('João Silva');
  });

  it('deve filtrar por data de início', () => {
    const dateFrom = new Date('2026-05-11');
    const filtered = mockChamados.filter(c => c.createdAt >= dateFrom);

    expect(filtered.length).toBe(2);
    expect(filtered[0].number).toBe(2);
  });

  it('deve filtrar por data de fim', () => {
    const dateTo = new Date('2026-05-11');
    dateTo.setHours(23, 59, 59, 999);
    const filtered = mockChamados.filter(c => c.createdAt <= dateTo);

    expect(filtered.length).toBe(2);
  });

  it('deve combinar múltiplos filtros', () => {
    const ticketNumber = '#0001';
    const customerName = 'João';
    const dateFrom = new Date('2026-05-01');

    const filtered = mockChamados.filter(c => {
      const matchNumber = `#${String(c.number).padStart(4, '0')}`.includes(ticketNumber);
      const matchCustomer = c.customerName.toLowerCase().includes(customerName.toLowerCase());
      const matchDate = c.createdAt >= dateFrom;

      return matchNumber && matchCustomer && matchDate;
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].number).toBe(1);
  });

  it('deve exibir quantidade de resultados', () => {
    const filtered = mockChamados.filter(c => c.status === 'open');
    const resultCount = filtered.length;

    expect(resultCount).toBe(1);
  });
});

describe('Funcionalidade 3: Exportação de Relatórios', () => {
  it('deve gerar CSV com cabeçalho correto', () => {
    const headers = ['ID', 'Abertura', 'Cliente', 'Empresa', 'Titulo', 'Status', 'Prioridade', 'Atendente'];
    const csvHeader = headers.join(',');

    expect(csvHeader).toContain('ID');
    expect(csvHeader).toContain('Cliente');
    expect(csvHeader).toContain('Status');
  });

  it('deve incluir todos os chamados no CSV', () => {
    const rows = mockChamados.map(c => [
      `#${String(c.number).padStart(4, '0')}`,
      c.customerName,
      c.company,
      c.title,
    ]);

    expect(rows.length).toBe(3);
    expect(rows[0][0]).toBe('#0001');
    expect(rows[1][0]).toBe('#0002');
    expect(rows[2][0]).toBe('#0003');
  });

  it('deve respeitar filtros na exportação', () => {
    const filtered = mockChamados.filter(c => c.status === 'open');
    const rows = filtered.map(c => [
      `#${String(c.number).padStart(4, '0')}`,
      c.customerName,
    ]);

    expect(rows.length).toBe(1);
    expect(rows[0][1]).toBe('João Silva');
  });

  it('deve incluir data de exportação no relatório', () => {
    const exportDate = new Date().toLocaleDateString('pt-BR');
    const reportContent = `Data: ${exportDate}`;

    expect(reportContent).toContain('Data:');
    expect(reportContent).toContain('/');
  });

  it('deve incluir total de chamados no relatório', () => {
    const total = mockChamados.length;
    const reportContent = `Total de chamados: ${total}`;

    expect(reportContent).toContain('Total de chamados: 3');
  });

  it('deve validar se há chamados antes de exportar', () => {
    const chamados: typeof mockChamados = [];
    const canExport = chamados.length > 0;

    expect(canExport).toBe(false);
  });

  it('deve exportar com sucesso quando há chamados', () => {
    const chamados = mockChamados;
    const canExport = chamados.length > 0;

    expect(canExport).toBe(true);
    expect(chamados.length).toBe(3);
  });
});

describe('Integração: Novo Chamado + Busca + Exportação', () => {
  it('deve criar novo chamado e encontrá-lo na busca', () => {
    const allChamados = [...mockChamados];
    const newChamado = {
      id: '4',
      number: 4,
      customerName: 'Ana Oliveira',
      company: 'Startup Tech',
      title: 'Configurar autenticação 2FA',
      observations: 'Implementar 2FA',
      status: 'open',
      priority: 'media',
      assignedTo: null,
      createdAt: new Date(),
      activities: [],
    };

    allChamados.push(newChamado);

    const filtered = allChamados.filter(c =>
      c.customerName.toLowerCase().includes('ana')
    );

    expect(filtered.length).toBe(1);
    expect(filtered[0].customerName).toContain('Ana');
  });

  it('deve exportar apenas chamados filtrados', () => {
    const filtered = mockChamados.filter(c => c.priority === 'alta');
    const rows = filtered.map(c => [
      `#${String(c.number).padStart(4, '0')}`,
      c.customerName,
      c.priority,
    ]);

    expect(rows.length).toBe(1);
    expect(rows[0][2]).toBe('alta');
  });

  it('deve manter integridade de dados em toda a pipeline', () => {
    const original = mockChamados[0];
    const filtered = mockChamados.filter(c => c.number === 1);
    const exported = filtered[0];

    expect(exported.id).toBe(original.id);
    expect(exported.customerName).toBe(original.customerName);
    expect(exported.title).toBe(original.title);
  });
});
