.PHONY: pdf clean

TEX = ionocast-methodology.tex
PDF = ionocast-methodology.pdf

pdf: $(PDF)

$(PDF): $(TEX)
	pdflatex -interaction=nonstopmode $(TEX)
	pdflatex -interaction=nonstopmode $(TEX)

clean:
	rm -f *.aux *.log *.out *.toc *.nav *.snm *.vrb *.fdb_latexmk *.fls *.synctex.gz
