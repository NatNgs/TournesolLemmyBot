package main

import (
	"net/url"
	"os"
	"strconv"
	"text/template"

	"github.com/Masterminds/sprig"
	"github.com/pelletier/go-toml/v2"
	"go.elara.ws/logger/log"
	"go.elara.ws/pcre"
)

type Config struct {
	Lemmy struct {
		InstanceURL string `toml:"instanceURL"`
		Account     struct {
			UserOrEmail string `toml:"userOrEmail"`
			Password    string `toml:"password"`
		} `toml:"account"`
	} `toml:"lemmy"`
	Regexp struct {
		Youtube string `toml:"youtube"`
	} `toml:"regexps"`
	Template struct {
		Reply         string `toml:"msg"`
		Tournesol     string `toml:"tournesol"`
		Tournesol_api string `toml:"tournesolapi"`
	} `toml:"templates"`
}

var (
	cfg             = Config{}
	compiledRegexes = map[string]*pcre.Regexp{}
	compiledTmpls   = map[string]*template.Template{}
)

func loadConfig(path string) error {
	fi, err := os.Stat(path)
	if err != nil {
		return err
	}

	if fi.Mode().Perm() != 0o600 {
		log.Fatal("Your config file's permissions are insecure. Please use chmod to set them to 600. Refusing to start.").Send()
	}

	fl, err := os.Open(path)
	if err != nil {
		return err
	}
	log.Debug("Opened config")

	err = toml.NewDecoder(fl).Decode(&cfg)
	if err != nil {
		return err
	}
	log.Debug("Decoded config")

	re, err := pcre.Compile(cfg.Regexp.Youtube)
	if err != nil {
		return err
	}
	compiledRegexes[cfg.Regexp.Youtube] = re
	log.Debug("Compiled Regexp")

	tmpl, err := template.New(strconv.Itoa(0)).Funcs(sprig.TxtFuncMap()).Parse(cfg.Template.Reply)
	if err != nil {
		return err
	}
	compiledTmpls[cfg.Template.Reply] = tmpl
	log.Debug("Compiled template")
	validateConfig()
	log.Debug("Validated config")
	return nil
}

func validateConfig() {
	_, err := url.Parse(cfg.Lemmy.InstanceURL)
	if err != nil {
		log.Fatal("Lemmy instance URL is not valid").Err(err).Send()
	}
}
