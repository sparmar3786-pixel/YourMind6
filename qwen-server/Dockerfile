FROM ghcr.io/ggml-org/llama.cpp:server

COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV LLAMA_ARG_HOST=0.0.0.0
ENV LLAMA_ARG_NO_WEBUI=true
ENV LLAMA_ARG_CTX_SIZE=8192
ENV LLAMA_ARG_PARALLEL=1
ENV LLAMA_ARG_THREADS=4
ENV LLAMA_CACHE=/models/cache

ENTRYPOINT ["/start.sh"]
