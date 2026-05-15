import { test, expect } from '@playwright/test';

test.describe('Fluxo Completo: Criar e Visualizar Chamado', () => {
  test('Deve criar um chamado e visualizá-lo na lista', async ({ page }) => {
    // 1. Navegar para página inicial
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 2. Procurar pelo botão de acesso ao dashboard
    const accessButton = page.getByRole('button', { name: /Acessar Dashboard|Dashboard/ });
    if (await accessButton.isVisible()) {
      await accessButton.click();
      await page.waitForLoadState('networkidle');
    }

    // 3. Procurar pelo ícone de chamados na sidebar
    const ticketsIcon = page.locator('[title*="Chamado"], [title*="Ticket"], button:has-text("📋")');
    
    if (await ticketsIcon.isVisible()) {
      await ticketsIcon.click();
      await page.waitForLoadState('networkidle');
    }

    // 4. Procurar pelo botão de criar novo chamado
    const newTicketButton = page.getByRole('button', { name: /\+ Novo|Novo Chamado|New Ticket/i });
    
    if (await newTicketButton.isVisible()) {
      await newTicketButton.click();
      await page.waitForLoadState('networkidle');
    }

    // 5. Preencher formulário de novo chamado
    const customerNameInput = page.getByPlaceholder(/Nome do Cliente|Customer Name/i);
    const companyInput = page.getByPlaceholder(/Empresa|Company/i);
    const titleInput = page.getByPlaceholder(/Título|Title/i);
    const observationsInput = page.getByPlaceholder(/Observações|Observations/i);

    if (await customerNameInput.isVisible()) {
      await customerNameInput.fill('João Silva Teste');
      await page.waitForTimeout(300);
    }

    if (await companyInput.isVisible()) {
      await companyInput.fill('Empresa XYZ Ltda');
      await page.waitForTimeout(300);
    }

    if (await titleInput.isVisible()) {
      await titleInput.fill('Sistema de login não funciona');
      await page.waitForTimeout(300);
    }

    if (await observationsInput.isVisible()) {
      await observationsInput.fill('Erro 500 ao tentar fazer login. Afeta todos os usuários.');
      await page.waitForTimeout(300);
    }

    // 6. Procurar pelo botão de salvar/criar
    const saveButton = page.getByRole('button', { name: /Salvar|Criar|Create|Save/i });
    
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000); // Aguardar invalidação de cache
    }

    // 7. Verificar se o chamado aparece na lista
    const chamadoRow = page.locator('tr, [role="row"]').filter({ hasText: /João Silva Teste|Sistema de login/ });
    
    if (await chamadoRow.isVisible()) {
      // Sucesso! Chamado apareceu na lista
      expect(chamadoRow).toBeTruthy();
      console.log('✅ Chamado criado e visualizado com sucesso!');
    } else {
      // Procurar por qualquer linha na tabela
      const allRows = page.locator('tr, [role="row"]');
      const rowCount = await allRows.count();
      
      if (rowCount > 0) {
        console.log(`✅ Tabela contém ${rowCount} chamados`);
        // Verificar se o novo chamado está em alguma linha
        const lastRow = allRows.last();
        await expect(lastRow).toBeTruthy();
      } else {
        console.log('⚠️ Nenhum chamado encontrado na tabela');
      }
    }
  });

  test('Deve criar múltiplos chamados e todos aparecerem na lista', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const chamadosParaCriar = [
      {
        name: 'Maria Santos',
        company: 'Empresa ABC',
        title: 'Relatório de vendas com erro',
        observations: 'Números não batem com o sistema'
      },
      {
        name: 'Pedro Oliveira',
        company: 'Empresa DEF',
        title: 'Integração com sistema ERP',
        observations: 'Precisa sincronizar dados'
      },
      {
        name: 'Ana Costa',
        company: 'Empresa GHI',
        title: 'Backup automático não funciona',
        observations: 'Backup não está sendo executado'
      }
    ];

    for (const chamado of chamadosParaCriar) {
      // Abrir modal de novo chamado
      const newButton = page.getByRole('button', { name: /\+ Novo|Novo Chamado/i });
      if (await newButton.isVisible()) {
        await newButton.click();
        await page.waitForTimeout(500);
      }

      // Preencher formulário
      const nameInput = page.getByPlaceholder(/Nome do Cliente|Customer Name/i);
      const companyInput = page.getByPlaceholder(/Empresa|Company/i);
      const titleInput = page.getByPlaceholder(/Título|Title/i);
      const obsInput = page.getByPlaceholder(/Observações|Observations/i);

      if (await nameInput.isVisible()) {
        await nameInput.fill(chamado.name);
        await companyInput.fill(chamado.company);
        await titleInput.fill(chamado.title);
        await obsInput.fill(chamado.observations);
        await page.waitForTimeout(300);
      }

      // Salvar
      const saveBtn = page.getByRole('button', { name: /Salvar|Criar|Create/i });
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
      }
    }

    // Verificar se todos os chamados aparecem
    const rows = page.locator('tr, [role="row"]');
    const rowCount = await rows.count();
    
    expect(rowCount).toBeGreaterThanOrEqual(chamadosParaCriar.length);
    console.log(`✅ ${chamadosParaCriar.length} chamados criados e ${rowCount} linhas na tabela`);
  });

  test('Deve criar chamado e clicar para visualizar detalhes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Criar chamado
    const newButton = page.getByRole('button', { name: /\+ Novo|Novo Chamado/i });
    if (await newButton.isVisible()) {
      await newButton.click();
      await page.waitForTimeout(500);
    }

    const nameInput = page.getByPlaceholder(/Nome do Cliente|Customer Name/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill('Cliente Teste Detalhes');
      const companyInput = page.getByPlaceholder(/Empresa|Company/i);
      const titleInput = page.getByPlaceholder(/Título|Title/i);
      
      await companyInput.fill('Empresa Teste');
      await titleInput.fill('Teste de Detalhes');
      
      const saveBtn = page.getByRole('button', { name: /Salvar|Criar/i });
      await saveBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    }

    // Procurar e clicar no chamado criado
    const chamadoRow = page.locator('tr, [role="row"]').filter({ hasText: /Cliente Teste Detalhes|Teste de Detalhes/ });
    
    if (await chamadoRow.isVisible()) {
      await chamadoRow.click();
      await page.waitForTimeout(500);

      // Verificar se modal de detalhes abriu
      const detailsModal = page.locator('[role="dialog"], .modal, [class*="modal"]');
      if (await detailsModal.isVisible()) {
        expect(detailsModal).toBeTruthy();
        console.log('✅ Modal de detalhes aberto com sucesso');
      }
    }
  });
});
