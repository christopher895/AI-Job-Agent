\ProvidesClass{czresume}[2010/07/10 v0.9 Resume class]
\LoadClass[10pt,letterpaper]{article}

\usepackage[T1]{fontenc}
\usepackage[parfill]{parskip}
\usepackage{array}
\usepackage{ifthen}
\usepackage{mathptmx}
\usepackage{enumitem}
\setlist[itemize]{leftmargin=*,topsep=-5pt,itemsep=0pt,parsep=0pt,partopsep=0pt}
\usepackage{hyperref}
\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,
    urlcolor=blue,
}

\pagestyle{empty}

%	HEADINGS
\def \name#1{\def\@name{#1}}
\def \@name {}
\def \addressSep {$-$}

\let \@addressone \relax
\let \@addresstwo \relax
\let \@addressthree \relax

\def \address #1{
  \@ifundefined{@addresstwo}{
    \def \@addresstwo {#1}
  }{
  \@ifundefined{@addressthree}{
    \def \@addressthree {#1}
  }{
    \def \@addressone {#1}
  }}
}

\def \printaddress #1{
  \begingroup
    \def \\ {\addressSep\ }
    \centerline{#1}
  \endgroup
  \par
  \addressskip
}

\def \printname {
  \begingroup
    \hfil{\namesize\bf \@name}\hfil
    \nameskip\break
  \endgroup
}

%	PRINT HEADING LINES
\let\ori@document=\document
\renewcommand{\document}{
  \ori@document
  \printname
  \@ifundefined{@addressone}{}{\printaddress{\@addressone}}
  \@ifundefined{@addresstwo}{}{\printaddress{\@addresstwo}}
  \@ifundefined{@addressthree}{}{\printaddress{\@addressthree}}
}

%	SECTION FORMATTING
\newenvironment{rSection}[1]{
  \sectionskip
  \MakeUppercase{{\bf #1}}
  \sectionlineskip
  \hrule
  \begin{list}{}{\setlength{\leftmargin}{0em}}
  \item[]
}{
  \end{list}
}

%	SPACING
\def\namesize{\LARGE}
\def\addressskip{\smallskip}
\def\sectionlineskip{\medskip}
\def\nameskip{\medskip}
\def\sectionskip{\smallskip}