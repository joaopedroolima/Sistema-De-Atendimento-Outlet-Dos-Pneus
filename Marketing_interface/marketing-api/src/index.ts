/**
 * Cloudflare Worker for Marketing Interface API
 * Handles media uploads to R2 and metadata management in D1.
 */

export interface Env {
	// Variaveis de ambiente definidas no wrangler.toml
	R2_BUCKET: R2Bucket;
	D1_DATABASE: D1Database;

	// Variavel definida na seção [vars] do wrangler.toml
	R2_PUBLIC_URL: string;
}

// Função auxiliar para retornar respostas JSON com headers CORS
function jsonResponse(data: any, status = 200, headers: HeadersInit = {}) {
	const finalHeaders = {
		'Content-Type': 'application/json',
		...headers,
	};
	return new Response(JSON.stringify(data), { status, headers: finalHeaders });
}

// Função auxiliar para lidar com erros
function errorResponse(message: string, status = 500, headers: HeadersInit = {}) {
	return jsonResponse({ error: message }, status, headers);
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Headers CORS para permitir que o frontend acesse a API
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*', // Em produção, restrinja para o seu domínio
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		// Responde a requisições pre-flight (OPTIONS) do navegador
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			// Rota para LISTAR todas as mídias
			if (request.method === 'GET' && url.pathname === '/media') {
				const { results } = await env.D1_DATABASE.prepare('SELECT * FROM media ORDER BY media_order ASC').all();
				return jsonResponse(results || [], 200, corsHeaders);
			}

			// Rota para obter informações de armazenamento
			if (request.method === 'GET' && url.pathname === '/storage-info') {
				let totalSize = 0;
				let cursor: string | undefined = undefined;

				// O .list() é paginado, então iteramos até que não haja mais resultados
				while (true) {
					const listResult = await env.R2_BUCKET.list({
						limit: 1000, // Máximo por requisição
						cursor: cursor,
					});
					listResult.objects.forEach(obj => totalSize += obj.size);

					if (!listResult.truncated) break; // Sai do loop se não houver mais páginas
					cursor = listResult.cursor; // Pega o cursor para a próxima iteração
				}

				return jsonResponse({ usedBytes: totalSize }, 200, corsHeaders);
			}

			// Rota para UPLOAD de uma nova mídia
			if (request.method === 'POST' && url.pathname === '/media') {
				const formData = await request.formData();
				const file = formData.get('file') as unknown as File;
				const title = formData.get('title') as string;

				if (!file) {
					return errorResponse('Arquivo não enviado.', 400, corsHeaders);
				}

				const fileName = `${Date.now()}-${file.name.replace(/\s/g, '_')}`;
				
				await env.R2_BUCKET.put(fileName, file.stream(), {
					httpMetadata: { contentType: file.type },
				});

				if (!env.R2_PUBLIC_URL) {
					return errorResponse('A variável R2_PUBLIC_URL não está configurada no seu worker.', 500);
				}

				const fileUrl = `${env.R2_PUBLIC_URL}/${fileName}`;
				const id = crypto.randomUUID();
				const media_order = Date.now(); // Usado para ordem inicial
				const createdAt = Date.now();
				const type = file.type.startsWith('image/') ? 'Imagem' : 'Vídeo';

				const stmt = env.D1_DATABASE.prepare(
					'INSERT INTO media (id, title, fileName, url, type, status, media_order, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
				);
				await stmt.bind(id, title || file.name, fileName, fileUrl, type, 'ativo', media_order, createdAt).run();

				const newMedia = { id, title: title || file.name, url: fileUrl, type, status: 'ativo', media_order, createdAt };
				return jsonResponse(newMedia, 201, corsHeaders);
			}

			// Rota para DELETAR uma mídia
			if (request.method === 'DELETE' && url.pathname.startsWith('/media/')) {
				const id = url.pathname.split('/')[2];
				if (!id) {
					return errorResponse('ID da mídia não fornecido.', 400, corsHeaders);
				}

				const media = await env.D1_DATABASE.prepare('SELECT fileName FROM media WHERE id = ?').bind(id).first<{ fileName: string }>();

				if (media && media.fileName) {
					await env.R2_BUCKET.delete(media.fileName);
				}

				await env.D1_DATABASE.prepare('DELETE FROM media WHERE id = ?').bind(id).run();

				return new Response(null, { status: 204, headers: corsHeaders });
			}

			// Rota para REORDENAR a lista inteira
			if (request.method === 'PUT' && url.pathname === '/media/reorder') {
				const { orderedIds } = await request.json<{ orderedIds: string[] }>();
				if (!orderedIds || !Array.isArray(orderedIds)) {
					return errorResponse('Array de IDs ordenados não fornecido.', 400, corsHeaders);
				}

				// Cria um batch de updates para o D1
				const batch = orderedIds.map((id, index) =>
					env.D1_DATABASE.prepare('UPDATE media SET media_order = ? WHERE id = ?').bind(index, id)
				);

				await env.D1_DATABASE.batch(batch);
				return jsonResponse({ message: 'Ordem atualizada com sucesso' }, 200, corsHeaders);
			}

			// Rota para ATUALIZAR status ou título de uma mídia específica
			if (request.method === 'PUT' && url.pathname.startsWith('/media/')) {
				const id = url.pathname.split('/')[2];
				if (!id) {
					return errorResponse('ID da mídia não fornecido.', 400, corsHeaders);
				}

				const body = await request.json<{ status?: string; title?: string; }>();
				const updates: string[] = [];
				const values: (string|number)[] = [];

				if (body.status) {
					updates.push('status = ?');
					values.push(body.status);
				}
				if (body.title) {
					updates.push('title = ?');
					values.push(body.title);
				}

				if (updates.length === 0) {
					return errorResponse('Nenhum campo para atualizar foi fornecido.', 400, corsHeaders);
				}

				values.push(id); // Adiciona o ID para a cláusula WHERE

				const query = `UPDATE media SET ${updates.join(', ')} WHERE id = ?`;
				await env.D1_DATABASE.prepare(query).bind(...values).run();

				return jsonResponse({ message: 'Mídia atualizada com sucesso' }, 200, corsHeaders);
			}

			return errorResponse('Rota não encontrada.', 404, corsHeaders);

		} catch (e: any) {
			console.error('Worker Error:', e);
			return errorResponse(e.message, 500, corsHeaders);
		}
	},
} satisfies ExportedHandler<Env>;
