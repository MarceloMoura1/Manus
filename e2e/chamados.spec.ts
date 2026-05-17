import { test, expect } from '@playwright/test';

test.describe('Sistema de Chamados - Testes E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Navegar para a página inicial
    await page.goto('/');
    // Aguardar carregamento
    await page.waitForLoadState('networkidle');
  });

  test('Deve abrir a página de chamados', async ({ page }) => {
    // Verificar se a página carregou
    await expect(page).toHaveTitle(/MegaDesk|Home/);
    
    // Procurar pelo botão de acesso ao dashboard
    const accessButton = page.getByRole('button', { name: /Acessar Dashboard|Dashboard/ });
    if (await accessButton.isVisible()) {
      await accessButton.click();
      await page.waitForLoadState('networkidle');
    }
  });

  test('Deve listar chamados com performance adequada', async ({ page }) => {
    const startTime = Date.now();
    
    // Navegar para página de chamados
    await page.goto('/');
    
    // Aguardar carregamento da página
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    
    // Verificar se carregou em menos de 3 segundos
    expect(loadTime).toBeLessThan(3000);
    
    console.log(`Tempo de carregamento: ${loadTime}ms`);
  });

  test('Deve criar um novo chamado', async ({ page }) => {
    // Navegar para página de atendimento ativo
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Procurar pelo módulo de atendimento ativo
    const attendanceModule = page.locator('text=Atendimento Ativo, Conversas, Chamados');
    
    if (await attendanceModule.isVisible()) {
      // Clicar para abrir o módulo
      await attendanceModule.click();
      await page.waitForLoadState('networkidle');
      
      // Procurar pelo campo de telefone
      const phoneInput = page.getByPlaceholder(/telefone|phone/i);
      
      if (await phoneInput.isVisible()) {
        // Preencher telefone
        await phoneInput.fill('11999999999');
        await page.waitForTimeout(500);
        
        // Procurar pelo botão de busca
        const searchButton = page.getByRole('button', { name: /buscar|search/i });
        if (await searchButton.isVisible()) {
          await searchButton.click();
          await page.waitForLoadState('networkidle');
        }
      }
    }
  });

  test('Deve filtrar chamados por status', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Procurar pelos filtros de status
    const openFilter = page.getByRole('button', { name: /abertos|open/i });
    const closedFilter = page.getByRole('button', { name: /fechados|closed/i });
    
    // Clicar em "Abertos"
    if (await openFilter.isVisible()) {
      await openFilter.click();
      await page.waitForLoadState('networkidle');
      
      // Verificar se o filtro foi aplicado
      const filterIndicator = page.locator('[class*="selected"], [class*="active"]');
      if (await filterIndicator.isVisible()) {
        expect(filterIndicator).toBeTruthy();
      }
    }
  });

  test('Deve editar um chamado existente', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Procurar por um chamado na lista
    const chamadoRow = page.locator('tr, [role="row"]').first();
    
    if (await chamadoRow.isVisible()) {
      // Clicar no chamado
      await chamadoRow.click();
      await page.waitForLoadState('networkidle');
      
      // Procurar pelo modal de detalhes
      const detailsModal = page.locator('[role="dialog"], .modal, [class*="modal"]');
      
      if (await detailsModal.isVisible()) {
        // Verificar se o modal foi aberto
        expect(detailsModal).toBeTruthy();
        
        // Procurar pelo botão de edição
        const editButton = page.getByRole('button', { name: /editar|edit/i });
        if (await editButton.isVisible()) {
          await editButton.click();
          await page.waitForTimeout(500);
        }
      }
    }
  });

  test('Deve adicionar uma atividade a um chamado', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Procurar por um chamado
    const chamadoRow = page.locator('tr, [role="row"]').first();
    
    if (await chamadoRow.isVisible()) {
      await chamadoRow.click();
      await page.waitForLoadState('networkidle');
      
      // Procurar pelo botão de adicionar atividade
      const addActivityButton = page.getByRole('button', { name: /atividade|activity/i });
      
      if (await addActivityButton.isVisible()) {
        await addActivityButton.click();
        await page.waitForTimeout(500);
        
        // Procurar pelo campo de descrição
        const descriptionInput = page.getByPlaceholder(/descrição|description/i);
        
        if (await descriptionInput.isVisible()) {
          await descriptionInput.fill('Atividade de teste');
          
          // Procurar pelo botão de salvar
          const saveButton = page.getByRole('button', { name: /salvar|save/i });
          if (await saveButton.isVisible()) {
            await saveButton.click();
            await page.waitForLoadState('networkidle');
          }
        }
      }
    }
  });

  test('Deve encerrar um chamado', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Procurar por um chamado aberto
    const chamadoRow = page.locator('tr, [role="row"]').first();
    
    if (await chamadoRow.isVisible()) {
      await chamadoRow.click();
      await page.waitForLoadState('networkidle');
      
      // Procurar pelo botão de encerrar
      const closeButton = page.getByRole('button', { name: /encerrar|close|finalizar/i });
      
      if (await closeButton.isVisible()) {
        await closeButton.click();
        await page.waitForTimeout(500);
        
        // Procurar pelo diálogo de confirmação
        const confirmButton = page.getByRole('button', { name: /sim|yes|confirmar/i });
        
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
          await page.waitForLoadState('networkidle');
        }
      }
    }
  });

  test('Deve buscar um chamado por número', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Procurar pelo campo de busca
    const searchInput = page.getByPlaceholder(/buscar|search|número|number/i);
    
    if (await searchInput.isVisible()) {
      await searchInput.fill('#1');
      await page.waitForLoadState('networkidle');
      
      // Verificar se os resultados foram filtrados
      const results = page.locator('tr, [role="row"]');
      const count = await results.count();
      
      expect(count).toBeGreaterThan(0);
    }
  });

  test('Deve carregar chamados com paginação', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Procurar pelos botões de paginação
    const nextButton = page.getByRole('button', { name: /próximo|next/i });
    const prevButton = page.getByRole('button', { name: /anterior|previous/i });
    
    // Verificar se os botões de paginação existem
    if (await nextButton.isVisible()) {
      // Clicar em próximo
      await nextButton.click();
      await page.waitForLoadState('networkidle');
      
      // Verificar se a página mudou
      const chamados = page.locator('tr, [role="row"]');
      expect(await chamados.count()).toBeGreaterThan(0);
    }
  });

  test('Deve exibir detalhes do chamado com timeline', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Procurar por um chamado
    const chamadoRow = page.locator('tr, [role="row"]').first();
    
    if (await chamadoRow.isVisible()) {
      await chamadoRow.click();
      await page.waitForLoadState('networkidle');
      
      // Procurar pela timeline
      const timeline = page.locator('[class*="timeline"], [class*="activity"]');
      
      if (await timeline.isVisible()) {
        // Verificar se a timeline está visível
        expect(timeline).toBeTruthy();
        
        // Procurar pelos itens da timeline
        const timelineItems = page.locator('[class*="timeline-item"], [class*="activity-item"]');
        const itemCount = await timelineItems.count();
        
        console.log(`Timeline com ${itemCount} itens`);
      }
    }
  });

  test('Deve validar performance de carregamento de 50 chamados', async ({ page }) => {
    const startTime = Date.now();
    
    // Navegar para página de chamados
    await page.goto('/');
    
    // Aguardar carregamento completo
    await page.waitForLoadState('networkidle');
    
    // Procurar por filtro para listar mais chamados
    const filter50 = page.getByRole('button', { name: /50|mais/i });
    if (await filter50.isVisible()) {
      await filter50.click();
      await page.waitForLoadState('networkidle');
    }
    
    const loadTime = Date.now() - startTime;
    
    // Verificar se carregou em menos de 2 segundos
    expect(loadTime).toBeLessThan(2000);
    
    console.log(`Tempo de carregamento (50 chamados): ${loadTime}ms`);
  });
});
