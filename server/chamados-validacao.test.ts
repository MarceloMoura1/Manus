/**
 * Testes de Validação e Sanitização para Sistema de Chamados
 * Testes unitários sem dependência de banco de dados
 */

import { describe, it, expect } from 'vitest';

// Funções de validação extraídas de db-chamados.ts
const VALID_STATUSES = ['open', 'in_progress', 'waiting', 'closed'] as const;
const VALID_PRIORITIES = ['baixa', 'media', 'alta', 'critica'] as const;
const MAX_STRING_LENGTH = 500;
const MAX_OBSERVATIONS_LENGTH = 2000;

function sanitizeString(str: string, maxLength: number = MAX_STRING_LENGTH): string {
  if (!str) return '';
  
  let sanitized = str
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .substring(0, maxLength);
  
  return sanitized;
}

function validateNonEmptyString(str: string, fieldName: string): void {
  if (!str || !str.trim()) {
    throw new Error(`${fieldName} não pode estar vazio`);
  }
}

function validateStatus(status: string): asserts status is typeof VALID_STATUSES[number] {
  if (!VALID_STATUSES.includes(status as any)) {
    throw new Error(`Status inválido: ${status}. Valores válidos: ${VALID_STATUSES.join(', ')}`);
  }
}

function validatePriority(priority: string): asserts priority is typeof VALID_PRIORITIES[number] {
  if (!VALID_PRIORITIES.includes(priority as any)) {
    throw new Error(`Prioridade inválida: ${priority}. Valores válidos: ${VALID_PRIORITIES.join(', ')}`);
  }
}

describe('Validação - Strings Vazias', () => {
  it('deve rejeitar string vazia', () => {
    expect(() => validateNonEmptyString('', 'fieldName')).toThrow('fieldName não pode estar vazio');
  });

  it('deve rejeitar string com apenas espaços', () => {
    expect(() => validateNonEmptyString('   ', 'fieldName')).toThrow('fieldName não pode estar vazio');
  });

  it('deve aceitar string válida', () => {
    expect(() => validateNonEmptyString('valid', 'fieldName')).not.toThrow();
  });
});

describe('Validação - Status', () => {
  it('deve aceitar status válidos', () => {
    for (const status of VALID_STATUSES) {
      expect(() => validateStatus(status)).not.toThrow();
    }
  });

  it('deve rejeitar status inválido', () => {
    expect(() => validateStatus('invalid')).toThrow('Status inválido');
  });

  it('deve rejeitar status em maiúscula', () => {
    expect(() => validateStatus('OPEN')).toThrow('Status inválido');
  });

  it('deve listar valores válidos na mensagem de erro', () => {
    try {
      validateStatus('invalid');
      expect.fail('Deveria ter lançado erro');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('open');
      expect(message).toContain('in_progress');
      expect(message).toContain('waiting');
      expect(message).toContain('closed');
    }
  });
});

describe('Validação - Prioridade', () => {
  it('deve aceitar prioridades válidas', () => {
    for (const priority of VALID_PRIORITIES) {
      expect(() => validatePriority(priority)).not.toThrow();
    }
  });

  it('deve rejeitar prioridade inválida', () => {
    expect(() => validatePriority('urgente')).toThrow('Prioridade inválida');
  });

  it('deve rejeitar prioridade em maiúscula', () => {
    expect(() => validatePriority('ALTA')).toThrow('Prioridade inválida');
  });

  it('deve listar valores válidos na mensagem de erro', () => {
    try {
      validatePriority('invalid');
      expect.fail('Deveria ter lançado erro');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('baixa');
      expect(message).toContain('media');
      expect(message).toContain('alta');
      expect(message).toContain('critica');
    }
  });
});

describe('Sanitização - Caracteres de Controle', () => {
  it('deve remover caracteres de controle ASCII', () => {
    const input = 'Hello\x00World\x01Test\x1FData\x7F';
    const result = sanitizeString(input);
    
    expect(result).not.toContain('\x00');
    expect(result).not.toContain('\x01');
    expect(result).not.toContain('\x1F');
    expect(result).not.toContain('\x7F');
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('deve remover múltiplos caracteres de controle consecutivos', () => {
    const input = 'Test\x00\x01\x02\x03String';
    const result = sanitizeString(input);
    
    expect(result).toBe('TestString');
  });

  it('deve preservar caracteres válidos', () => {
    const input = 'Hello World! 123 @#$%';
    const result = sanitizeString(input);
    
    expect(result).toBe('Hello World! 123 @#$%');
  });
});

describe('Sanitização - Espaços em Branco', () => {
  it('deve remover espaços no início', () => {
    const result = sanitizeString('   Hello');
    expect(result).toBe('Hello');
  });

  it('deve remover espaços no final', () => {
    const result = sanitizeString('Hello   ');
    expect(result).toBe('Hello');
  });

  it('deve remover espaços no início e fim', () => {
    const result = sanitizeString('   Hello World   ');
    expect(result).toBe('Hello World');
  });

  it('deve preservar espaços no meio', () => {
    const result = sanitizeString('  Hello  World  ');
    expect(result).toBe('Hello  World');
  });
});

describe('Sanitização - Truncamento', () => {
  it('deve truncar string acima do limite', () => {
    const longString = 'a'.repeat(600);
    const result = sanitizeString(longString, MAX_STRING_LENGTH);
    
    expect(result.length).toBeLessThanOrEqual(MAX_STRING_LENGTH);
    expect(result.length).toBe(MAX_STRING_LENGTH);
  });

  it('deve preservar string abaixo do limite', () => {
    const shortString = 'Hello World';
    const result = sanitizeString(shortString, MAX_STRING_LENGTH);
    
    expect(result).toBe(shortString);
  });

  it('deve respeitar limite customizado', () => {
    const input = 'a'.repeat(100);
    const result = sanitizeString(input, 50);
    
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.length).toBe(50);
  });

  it('deve truncar observações corretamente', () => {
    const longObs = 'a'.repeat(3000);
    const result = sanitizeString(longObs, MAX_OBSERVATIONS_LENGTH);
    
    expect(result.length).toBeLessThanOrEqual(MAX_OBSERVATIONS_LENGTH);
    expect(result.length).toBe(MAX_OBSERVATIONS_LENGTH);
  });
});

describe('Sanitização - Casos Combinados', () => {
  it('deve sanitizar string com múltiplos problemas', () => {
    const input = '   Hello\x00World\x1F  Test\x7F  ';
    const result = sanitizeString(input);
    
    expect(result).toBe('HelloWorld  Test');
  });

  it('deve sanitizar string muito longa com caracteres de controle', () => {
    const input = 'a'.repeat(600) + '\x00\x01\x02' + 'b'.repeat(600);
    const result = sanitizeString(input, MAX_STRING_LENGTH);
    
    expect(result.length).toBeLessThanOrEqual(MAX_STRING_LENGTH);
    expect(result).not.toContain('\x00');
    expect(result).not.toContain('\x01');
    expect(result).not.toContain('\x02');
  });

  it('deve sanitizar string com espaços e caracteres de controle', () => {
    const input = '  \x00Test\x1F  String\x7F  ';
    const result = sanitizeString(input);
    
    expect(result).toBe('Test  String');
  });
});

describe('Sanitização - Strings Especiais', () => {
  it('deve preservar números', () => {
    const input = '123 456 789';
    const result = sanitizeString(input);
    
    expect(result).toBe('123 456 789');
  });

  it('deve preservar caracteres especiais válidos', () => {
    const input = 'Test@Email.com #123 $50 50%';
    const result = sanitizeString(input);
    
    expect(result).toBe('Test@Email.com #123 $50 50%');
  });

  it('deve preservar caracteres acentuados', () => {
    const input = 'João Silva Açúcar Côco';
    const result = sanitizeString(input);
    
    expect(result).toBe('João Silva Açúcar Côco');
  });

  it('deve preservar emojis (se suportados)', () => {
    const input = 'Test 😀 Emoji 🎉';
    const result = sanitizeString(input);
    
    expect(result).toBe('Test 😀 Emoji 🎉');
  });
});

describe('Sanitização - Edge Cases', () => {
  it('deve lidar com string vazia', () => {
    const result = sanitizeString('');
    expect(result).toBe('');
  });

  it('deve lidar com string nula', () => {
    const result = sanitizeString(null as any);
    expect(result).toBe('');
  });

  it('deve lidar com string undefined', () => {
    const result = sanitizeString(undefined as any);
    expect(result).toBe('');
  });

  it('deve lidar com string com apenas caracteres de controle', () => {
    const input = '\x00\x01\x02\x03\x04';
    const result = sanitizeString(input);
    
    expect(result).toBe('');
  });

  it('deve lidar com string com apenas espaços', () => {
    const input = '     ';
    const result = sanitizeString(input);
    
    expect(result).toBe('');
  });

  it('deve lidar com string muito longa com apenas um caractere', () => {
    const input = 'a'.repeat(10000);
    const result = sanitizeString(input, MAX_STRING_LENGTH);
    
    expect(result.length).toBe(MAX_STRING_LENGTH);
    expect(result).toBe('a'.repeat(MAX_STRING_LENGTH));
  });
});

describe('Validação - Combinações', () => {
  it('deve validar múltiplos campos corretamente', () => {
    expect(() => {
      validateNonEmptyString('John', 'customerName');
      validateNonEmptyString('Company', 'company');
      validateNonEmptyString('Title', 'title');
      validateStatus('open');
      validatePriority('media');
    }).not.toThrow();
  });

  it('deve falhar na primeira validação inválida', () => {
    expect(() => {
      validateNonEmptyString('', 'customerName');
      validateNonEmptyString('Company', 'company'); // Não deve chegar aqui
    }).toThrow('customerName não pode estar vazio');
  });
});

describe('Performance - Sanitização', () => {
  it('deve sanitizar string grande rapidamente', () => {
    const input = 'a'.repeat(100000);
    const start = Date.now();
    const result = sanitizeString(input, MAX_STRING_LENGTH);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(100); // Deve ser rápido
    expect(result.length).toBeLessThanOrEqual(MAX_STRING_LENGTH);
  });

  it('deve sanitizar múltiplas strings rapidamente', () => {
    const start = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      sanitizeString(`String ${i} with\x00control\x1Fchars`, MAX_STRING_LENGTH);
    }
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500); // 1000 sanitizações em menos de 500ms
  });
});
